import "server-only";
import { headers as nextHeaders } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth/auth";
import { prisma } from "@/server/db/client";
import type { statement } from "@/server/auth/permissions";

type PermissionRequest = {
  [K in keyof typeof statement]?: (typeof statement)[K][number][];
};

/** Reads the current session (or `null`) from the incoming request headers. */
export async function getSession() {
  return auth.api.getSession({ headers: await nextHeaders() });
}

/** Reads the current session or redirects to /login. Use in Server Components. */
export async function requireSession() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}

/**
 * Resolves the caller's active organization and their membership row.
 * Redirects to the org picker if the session has no active organization,
 * or to /login if there's no session at all.
 */
export async function requireActiveOrganization() {
  const session = await requireSession();
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) {
    redirect("/organizations");
  }

  const member = await prisma.member.findFirst({
    where: { organizationId, userId: session.user.id },
    include: { organization: true },
  });

  if (!member) {
    redirect("/organizations");
  }

  return { session, member, organization: member.organization };
}

/**
 * Server-side permission check against the active organization. Throws a
 * plain `Error` (callers in route handlers should catch and return 403;
 * Server Actions should let it propagate to the error boundary) rather than
 * redirecting, since a permission failure is exceptional, not a routing
 * concern.
 */
export async function requirePermission(permissions: PermissionRequest) {
  const { session, organization } = await requireActiveOrganization();

  const result = await auth.api.hasPermission({
    headers: await nextHeaders(),
    body: {
      organizationId: organization.id,
      permissions: permissions as Record<string, string[]>,
    },
  });

  if (!result.success) {
    throw new Error("Forbidden: missing required permission");
  }

  return { session, organization };
}
