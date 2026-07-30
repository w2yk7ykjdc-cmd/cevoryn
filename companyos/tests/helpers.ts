import { randomUUID } from "node:crypto";
import { auth } from "@/server/auth/auth";
import { prisma } from "@/server/db/client";
import { shutdownEventBus } from "@/server/events/event-bus";
import type { OrganizationRoleName } from "@/server/auth/permissions";

export function uniqueEmail(prefix = "test"): string {
  return `${prefix}-${randomUUID()}@example.com`;
}

export function uniqueSlug(prefix = "org"): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

export type TestUser = {
  token: string;
  userId: string;
  email: string;
  password: string;
};

/** Creates a real user via the sign-up endpoint and returns a bearer token for it. */
export async function signUpUser(overrides?: {
  email?: string;
  name?: string;
  password?: string;
}): Promise<TestUser> {
  const email = overrides?.email ?? uniqueEmail();
  const name = overrides?.name ?? "Test User";
  const password = overrides?.password ?? "password12345";

  const result = await auth.api.signUpEmail({ body: { email, name, password } });
  if (!result.token) {
    throw new Error("sign-up did not return a session token");
  }

  return { token: result.token, userId: result.user.id, email, password };
}

/** Headers a real authenticated request would carry (bearer plugin honors this). */
export function authHeaders(token: string): Headers {
  return new Headers({ authorization: `Bearer ${token}` });
}

/** Creates an organization owned by `owner`; Better Auth auto-assigns the owner role and active org. */
export async function createOrgForUser(
  owner: TestUser,
  overrides?: { name?: string; slug?: string },
) {
  const organization = await auth.api.createOrganization({
    headers: authHeaders(owner.token),
    body: {
      name: overrides?.name ?? "Test Org",
      slug: overrides?.slug ?? uniqueSlug(),
    },
  });
  if (!organization) {
    throw new Error("organization creation failed");
  }
  return organization;
}

/**
 * Adds `user` to `organizationId` with `role` directly (server-only endpoint,
 * bypasses the invitation flow) — for test setup only.
 */
export async function addMemberDirect(
  organizationId: string,
  user: TestUser,
  role: OrganizationRoleName,
) {
  return auth.api.addMember({
    body: { organizationId, userId: user.userId, role },
  });
}

/** Closes the DB/Redis connections opened during a test file's run, so vitest can exit cleanly. */
export async function closeTestConnections(): Promise<void> {
  await Promise.all([prisma.$disconnect(), shutdownEventBus()]);
}
