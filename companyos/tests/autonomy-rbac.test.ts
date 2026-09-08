import { afterAll, describe, expect, it } from "vitest";
import "@/server/ai/tools/builtin";
import {
  AutonomyPolicyPermissionError,
  addAllowlistEntry,
  disengageKillSwitch,
  engageKillSwitch,
  removeAllowlistEntry,
  updatePolicy,
} from "@/server/ai/autonomy/policy-service";
import { decideApproval } from "@/server/ai/approval/service";
import { executeToolCall } from "@/server/ai/tools/executor";
import { createConversation } from "@/server/ai/runtime/conversations";
import { closeTestConnections, createOrgForUser, signUpUser, authHeaders, addMemberDirect } from "./helpers";

function baseUpdateInput(organizationId: string, changedById: string, requestHeaders: Headers) {
  return {
    organizationId,
    domain: "crm",
    level: "L2" as const,
    dailyActionLimit: 0,
    dailyRiskLimit: 0,
    perActionRiskLimit: 0,
    changedById,
    requestHeaders,
  };
}

describe("Autonomy RBAC: owner/admin/member/viewer", () => {
  afterAll(closeTestConnections);

  it("owner can manage policy", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    const policy = await updatePolicy(baseUpdateInput(organization.id, owner.userId, authHeaders(owner.token)));
    expect(policy.level).toBe("L2");
  });

  it("owner can engage and disengage the kill switch", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const headers = authHeaders(owner.token);

    const engaged = await engageKillSwitch({ organizationId: organization.id, domain: "crm", actorId: owner.userId, requestHeaders: headers });
    expect(engaged.killSwitchEngaged).toBe(true);

    const disengaged = await disengageKillSwitch({ organizationId: organization.id, domain: "crm", actorId: owner.userId, requestHeaders: headers });
    expect(disengaged.killSwitchEngaged).toBe(false);
  });

  it("owner can manage the L4/L5 allowlist", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const headers = authHeaders(owner.token);

    const entry = await addAllowlistEntry({
      organizationId: organization.id,
      domain: "crm",
      toolName: "some_tool",
      minLevelRequired: "L4",
      addedById: owner.userId,
      requestHeaders: headers,
    });
    expect(entry.toolName).toBe("some_tool");

    await removeAllowlistEntry({ organizationId: organization.id, domain: "crm", toolName: "some_tool", removedById: owner.userId, requestHeaders: headers });
  });

  it("admin can engage the kill switch but cannot manage the full policy", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const admin = await signUpUser();
    await addMemberDirect(organization.id, admin, "admin");
    const adminHeaders = authHeaders(admin.token);

    const engaged = await engageKillSwitch({ organizationId: organization.id, domain: "crm", actorId: admin.userId, requestHeaders: adminHeaders });
    expect(engaged.killSwitchEngaged).toBe(true);

    await expect(updatePolicy(baseUpdateInput(organization.id, admin.userId, adminHeaders))).rejects.toThrow(
      AutonomyPolicyPermissionError,
    );
  });

  it("admin cannot disengage the kill switch — that requires the fuller manage permission", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await engageKillSwitch({ organizationId: organization.id, domain: "crm", actorId: owner.userId, requestHeaders: authHeaders(owner.token) });

    const admin = await signUpUser();
    await addMemberDirect(organization.id, admin, "admin");

    await expect(
      disengageKillSwitch({ organizationId: organization.id, domain: "crm", actorId: admin.userId, requestHeaders: authHeaders(admin.token) }),
    ).rejects.toThrow(AutonomyPolicyPermissionError);
  });

  it("admin cannot manage the allowlist", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const admin = await signUpUser();
    await addMemberDirect(organization.id, admin, "admin");

    await expect(
      addAllowlistEntry({
        organizationId: organization.id,
        domain: "crm",
        toolName: "some_tool",
        minLevelRequired: "L4",
        addedById: admin.userId,
        requestHeaders: authHeaders(admin.token),
      }),
    ).rejects.toThrow(AutonomyPolicyPermissionError);
  });

  it("member has no autonomy policy access at all", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const member = await signUpUser();
    await addMemberDirect(organization.id, member, "member");
    const memberHeaders = authHeaders(member.token);

    await expect(updatePolicy(baseUpdateInput(organization.id, member.userId, memberHeaders))).rejects.toThrow(
      AutonomyPolicyPermissionError,
    );
    await expect(
      engageKillSwitch({ organizationId: organization.id, domain: "crm", actorId: member.userId, requestHeaders: memberHeaders }),
    ).rejects.toThrow(AutonomyPolicyPermissionError);
  });

  it("viewer has no autonomy policy access at all", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const viewer = await signUpUser();
    await addMemberDirect(organization.id, viewer, "viewer");
    const viewerHeaders = authHeaders(viewer.token);

    await expect(updatePolicy(baseUpdateInput(organization.id, viewer.userId, viewerHeaders))).rejects.toThrow(
      AutonomyPolicyPermissionError,
    );
    await expect(
      engageKillSwitch({ organizationId: organization.id, domain: "crm", actorId: viewer.userId, requestHeaders: viewerHeaders }),
    ).rejects.toThrow(AutonomyPolicyPermissionError);
  });

  it("deciding an AgentApproval still requires the underlying tool's own permission, unchanged by Sprint 9", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const viewer = await signUpUser();
    await addMemberDirect(organization.id, viewer, "viewer");
    const conversation = await createConversation({ organizationId: organization.id, userId: owner.userId });

    const pending = await executeToolCall(
      { id: "rbac-1", name: "create_task", arguments: { title: "Needs approval" } },
      { organizationId: organization.id, userId: owner.userId, conversationId: conversation.id },
      authHeaders(owner.token),
    );
    expect(pending.status).toBe("pending_approval");
    if (pending.status !== "pending_approval") throw new Error("unreachable");

    // A viewer has no task:create permission, so cannot approve a create_task
    // approval even though they can see it exists -- confirming Sprint 9's
    // autonomy gate didn't loosen decideApproval's own pre-existing RBAC check.
    await expect(
      decideApproval({
        approvalId: pending.approvalId,
        organizationId: organization.id,
        decidedById: viewer.userId,
        decision: "approved",
        requestHeaders: authHeaders(viewer.token),
      }),
    ).rejects.toThrow(/permission/i);
  });
});
