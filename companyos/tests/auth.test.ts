import { afterAll, describe, expect, it } from "vitest";
import { auth } from "@/server/auth/auth";
import { prisma } from "@/server/db/client";
import {
  authHeaders,
  closeTestConnections,
  createOrgForUser,
  signUpUser,
  uniqueEmail,
} from "./helpers";

describe("auth", () => {
  afterAll(closeTestConnections);

  it("signs up a user with a real session token", async () => {
    const email = uniqueEmail();
    const user = await signUpUser({ email });

    expect(user.token).toBeTruthy();
    expect(user.userId).toBeTruthy();

    const dbUser = await prisma.user.findUnique({ where: { id: user.userId } });
    expect(dbUser?.email).toBe(email);
  });

  it("signs in with the credentials it just signed up with", async () => {
    const { email, password } = await signUpUser();

    const result = await auth.api.signInEmail({ body: { email, password } });

    expect(result.token).toBeTruthy();
    expect(result.user.email).toBe(email);
  });

  it("rejects sign-in with the wrong password", async () => {
    const { email } = await signUpUser({ password: "correct-password-123" });

    await expect(
      auth.api.signInEmail({ body: { email, password: "wrong-password-123" } }),
    ).rejects.toThrow();
  });

  it("resolves the caller's session from a bearer token", async () => {
    const user = await signUpUser();

    const session = await auth.api.getSession({ headers: authHeaders(user.token) });

    expect(session?.user.id).toBe(user.userId);
  });

  it("creating an organization makes the creator its owner and active org", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    const member = await prisma.member.findFirst({
      where: { organizationId: organization.id, userId: owner.userId },
    });
    expect(member?.role).toBe("owner");

    const session = await auth.api.getSession({ headers: authHeaders(owner.token) });
    expect(session?.session.activeOrganizationId).toBe(organization.id);
  });

  it("records an audit log entry when an organization is created", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    const entry = await prisma.auditLog.findFirst({
      where: { organizationId: organization.id, action: "organization.created" },
    });

    expect(entry).not.toBeNull();
    expect(entry?.actorId).toBe(owner.userId);
    expect(entry?.actorType).toBe("user");
  });
});
