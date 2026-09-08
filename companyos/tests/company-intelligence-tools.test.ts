import { afterAll, describe, expect, it } from "vitest";
import "@/server/ai/tools/builtin"; // registers get_company_health, get_opportunities
import { executeToolCall } from "@/server/ai/tools/executor";
import { createConversation } from "@/server/ai/runtime/conversations";
import { createLead } from "@/server/leads/service";
import { listPipelineStages } from "@/server/leads/pipeline";
import { scanCompanySignals } from "@/server/intelligence/signals/scanner";
import { generateOpportunitiesForOrganization } from "@/server/intelligence/opportunity/service";
import { recordHealthSnapshot } from "@/server/intelligence/health/service";
import { prisma } from "@/server/db/client";
import { addMemberDirect, authHeaders, closeTestConnections, createOrgForUser, signUpUser } from "./helpers";

async function setup(role: "owner" | "member" | "viewer" = "owner") {
  const owner = await signUpUser();
  const organization = await createOrgForUser(owner);

  let caller = owner;
  if (role !== "owner") {
    caller = await signUpUser();
    await addMemberDirect(organization.id, caller, role);
  }

  const conversation = await createConversation({ organizationId: organization.id, userId: caller.userId });
  return { owner, organization, conversation, caller };
}

async function backdateLeadActivity(leadId: string, daysAgo: number): Promise<void> {
  const when = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  await prisma.leadActivity.updateMany({ where: { leadId }, data: { createdAt: when } });
}

describe("get_company_health tool", () => {
  afterAll(closeTestConnections);

  it("computes a score on demand when no snapshot has been recorded yet", async () => {
    const { organization, conversation, caller } = await setup("owner");

    const result = await executeToolCall(
      { id: "call-1", name: "get_company_health", arguments: {} },
      { organizationId: organization.id, userId: caller.userId, conversationId: conversation.id },
      authHeaders(caller.token),
    );

    expect(result.status).toBe("success");
    if (result.status === "success") {
      const output = result.output as { salesHealthScore: number; source: string };
      expect(output.salesHealthScore).toBe(100); // no open leads
      expect(output.source).toBe("computed_on_demand");
    }
  });

  it("returns the latest persisted snapshot once one exists", async () => {
    const { organization, conversation, caller } = await setup("owner");
    await recordHealthSnapshot(organization.id);

    const result = await executeToolCall(
      { id: "call-2", name: "get_company_health", arguments: {} },
      { organizationId: organization.id, userId: caller.userId, conversationId: conversation.id },
      authHeaders(caller.token),
    );

    expect(result.status).toBe("success");
    if (result.status === "success") {
      const output = result.output as { source: string };
      expect(output.source).toBe("snapshot");
    }
  });

  it("is readable by every role, including a read-only viewer", async () => {
    const { organization, conversation, caller } = await setup("viewer");

    const result = await executeToolCall(
      { id: "call-3", name: "get_company_health", arguments: {} },
      { organizationId: organization.id, userId: caller.userId, conversationId: conversation.id },
      authHeaders(caller.token),
    );

    expect(result.status).toBe("success");
  });

  it("logs the AI read to the audit log", async () => {
    const { organization, conversation, caller } = await setup("owner");

    await executeToolCall(
      { id: "call-4", name: "get_company_health", arguments: {} },
      { organizationId: organization.id, userId: caller.userId, conversationId: conversation.id },
      authHeaders(caller.token),
    );

    const entry = await prisma.auditLog.findFirst({
      where: { organizationId: organization.id, action: "company_health.ai_viewed" },
    });
    expect(entry).not.toBeNull();
  });
});

describe("get_opportunities tool", () => {
  afterAll(closeTestConnections);

  it("returns the organization's open opportunities ordered by score", async () => {
    const { organization, conversation, caller, owner } = await setup("owner");
    const stages = await listPipelineStages(organization.id);
    const openStage = stages.find((s) => !s.isWon && !s.isLost)!;
    const lead = await createLead({ organizationId: organization.id, actorId: owner.userId, title: "Stalled deal", value: 9000, stageId: openStage.id });
    await createLead({ organizationId: organization.id, actorId: owner.userId, title: "Filler", value: 0, stageId: openStage.id });
    await backdateLeadActivity(lead.id, 9);
    await scanCompanySignals();
    await generateOpportunitiesForOrganization(organization.id);

    const result = await executeToolCall(
      { id: "call-5", name: "get_opportunities", arguments: {} },
      { organizationId: organization.id, userId: caller.userId, conversationId: conversation.id },
      authHeaders(caller.token),
    );

    expect(result.status).toBe("success");
    if (result.status === "success") {
      const output = result.output as { opportunities: { title: string; relatedEntityId: string }[] };
      expect(output.opportunities).toHaveLength(1);
      expect(output.opportunities[0]?.relatedEntityId).toBe(lead.id);
    }
  });

  it("returns an empty list for an organization with no opportunities", async () => {
    const { organization, conversation, caller } = await setup("owner");

    const result = await executeToolCall(
      { id: "call-6", name: "get_opportunities", arguments: {} },
      { organizationId: organization.id, userId: caller.userId, conversationId: conversation.id },
      authHeaders(caller.token),
    );

    expect(result.status).toBe("success");
    if (result.status === "success") {
      const output = result.output as { opportunities: unknown[] };
      expect(output.opportunities).toHaveLength(0);
    }
  });

  it("rejects an invalid status filter", async () => {
    const { organization, conversation, caller } = await setup("owner");

    const result = await executeToolCall(
      { id: "call-7", name: "get_opportunities", arguments: { status: "not-a-real-status" } },
      { organizationId: organization.id, userId: caller.userId, conversationId: conversation.id },
      authHeaders(caller.token),
    );

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error).toMatch(/invalid arguments/i);
    }
  });

  it("is readable by every role, including a read-only viewer", async () => {
    const { organization, conversation, caller } = await setup("viewer");

    const result = await executeToolCall(
      { id: "call-8", name: "get_opportunities", arguments: {} },
      { organizationId: organization.id, userId: caller.userId, conversationId: conversation.id },
      authHeaders(caller.token),
    );

    expect(result.status).toBe("success");
  });
});
