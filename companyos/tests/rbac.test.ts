import { afterAll, describe, expect, it } from "vitest";
import { auth } from "@/server/auth/auth";
import {
  addMemberDirect,
  authHeaders,
  closeTestConnections,
  createOrgForUser,
  signUpUser,
} from "./helpers";

async function can(
  userToken: string,
  organizationId: string,
  permissions: Record<string, string[]>,
): Promise<boolean> {
  const result = await auth.api.hasPermission({
    headers: authHeaders(userToken),
    body: { organizationId, permissions },
  });
  return result.success;
}

describe("RBAC", () => {
  afterAll(closeTestConnections);

  it("owner can manage members, billing, and read audit logs", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    expect(await can(owner.token, organization.id, { member: ["delete"] })).toBe(true);
    expect(await can(owner.token, organization.id, { billing: ["manage"] })).toBe(true);
    expect(await can(owner.token, organization.id, { auditLog: ["read"] })).toBe(true);
    expect(await can(owner.token, organization.id, { organization: ["delete"] })).toBe(true);
  });

  it("admin can manage members but not delete the organization or manage billing", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const admin = await signUpUser();
    await addMemberDirect(organization.id, admin, "admin");

    expect(await can(admin.token, organization.id, { member: ["create", "delete"] })).toBe(true);
    expect(await can(admin.token, organization.id, { auditLog: ["read"] })).toBe(true);
    expect(await can(admin.token, organization.id, { organization: ["delete"] })).toBe(false);
    expect(await can(admin.token, organization.id, { billing: ["manage"] })).toBe(false);
  });

  it("member can use AI features but cannot manage members or read audit logs", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const member = await signUpUser();
    await addMemberDirect(organization.id, member, "member");

    expect(await can(member.token, organization.id, { aiConversation: ["create"] })).toBe(true);
    expect(await can(member.token, organization.id, { aiTool: ["execute"] })).toBe(true);
    expect(await can(member.token, organization.id, { member: ["delete"] })).toBe(false);
    expect(await can(member.token, organization.id, { auditLog: ["read"] })).toBe(false);
  });

  it("viewer is read-only and cannot execute AI tools or create conversations", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const viewer = await signUpUser();
    await addMemberDirect(organization.id, viewer, "viewer");

    expect(await can(viewer.token, organization.id, { auditLog: ["read"] })).toBe(true);
    expect(await can(viewer.token, organization.id, { aiConversation: ["read"] })).toBe(true);
    expect(await can(viewer.token, organization.id, { aiConversation: ["create"] })).toBe(false);
    expect(await can(viewer.token, organization.id, { aiTool: ["execute"] })).toBe(false);
    expect(await can(viewer.token, organization.id, { member: ["create"] })).toBe(false);
  });

  it("owner, admin, and member all get full CRUD on CRM resources; viewer is read-only", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const admin = await signUpUser();
    await addMemberDirect(organization.id, admin, "admin");
    const member = await signUpUser();
    await addMemberDirect(organization.id, member, "member");
    const viewer = await signUpUser();
    await addMemberDirect(organization.id, viewer, "viewer");

    for (const resource of ["company", "contact", "lead", "task"] as const) {
      for (const actor of [owner, admin, member]) {
        expect(await can(actor.token, organization.id, { [resource]: ["create", "read", "update", "delete"] })).toBe(
          true,
        );
      }
      expect(await can(viewer.token, organization.id, { [resource]: ["read"] })).toBe(true);
      expect(await can(viewer.token, organization.id, { [resource]: ["create"] })).toBe(false);
      expect(await can(viewer.token, organization.id, { [resource]: ["update"] })).toBe(false);
      expect(await can(viewer.token, organization.id, { [resource]: ["delete"] })).toBe(false);
    }
  });

  it("a user outside the organization has no permissions on it", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const outsider = await signUpUser();

    await expect(
      auth.api.hasPermission({
        headers: authHeaders(outsider.token),
        body: { organizationId: organization.id, permissions: { auditLog: ["read"] } },
      }),
    ).rejects.toThrow();
  });
});
