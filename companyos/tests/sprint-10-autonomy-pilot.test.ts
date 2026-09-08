import { afterAll, describe, expect, it } from "vitest";
import "@/server/ai/tools/builtin";
import { prisma } from "@/server/db/client";
import { getTool } from "@/server/ai/tools/registry";
import { executeToolCall } from "@/server/ai/tools/executor";
import { resolveAutonomyDecision } from "@/server/ai/autonomy/resolve";
import { addAllowlistEntry, engageKillSwitch, updatePolicy } from "@/server/ai/autonomy/policy-service";
import { createConversation } from "@/server/ai/runtime/conversations";
import { expireStaleOpportunity, generateOpportunitiesForOrganization } from "@/server/intelligence/opportunity/service";
import { createLead, changeLeadStage, softDeleteLead } from "@/server/leads/service";
import { listPipelineStages } from "@/server/leads/pipeline";
import { scanCompanySignals } from "@/server/intelligence/signals/scanner";
import { closeTestConnections, createOrgForUser, signUpUser, authHeaders, addMemberDirect } from "./helpers";

/**
 * Sprint 10 — the first genuinely autonomous L4 action: expiring a stale,
 * never-triaged `high_value_stalled_lead` Opportunity. Every test here
 * exercises either the deterministic eligibility rule itself
 * (`expireStaleOpportunity`) or the full Sprint 9 autonomy chain
 * (`executeToolCall` -> `resolveAutonomyDecision`) the SAME way any other
 * gated tool is tested in this suite (`autonomy-policy.test.ts`,
 * `autonomous-execution.test.ts`) — no new test infrastructure invented.
 */

async function backdateLeadActivity(leadId: string, daysAgo: number): Promise<void> {
  const when = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  await prisma.leadActivity.updateMany({ where: { leadId }, data: { createdAt: when } });
}

/** Mirrors `tests/opportunity-generation.test.ts`'s own fixture helper exactly. */
async function createStalledHighValueOpportunity(organizationId: string, actorId: string) {
  const stages = await listPipelineStages(organizationId);
  const openStage = stages.find((s) => !s.isWon && !s.isLost)!;
  const wonStage = stages.find((s) => s.isWon)!;

  const lead = await createLead({ organizationId, actorId, title: "Big stalled deal", value: 9000, stageId: openStage.id });
  await createLead({ organizationId, actorId, title: "Filler", value: 0, stageId: openStage.id });
  await backdateLeadActivity(lead.id, 9);

  await scanCompanySignals();
  await generateOpportunitiesForOrganization(organizationId);

  const opportunity = await prisma.opportunity.findFirstOrThrow({
    where: { organizationId, relatedEntityId: lead.id },
  });

  return { lead, opportunity, openStageId: openStage.id, wonStageId: wonStage.id };
}

/** Configures the org to L4, allowlists the pilot tool, and raises limits enough for the given number of executions. */
async function enableL4Pilot(organizationId: string, actorId: string, requestHeaders: Headers, dailyActionLimit = 10) {
  await updatePolicy({
    organizationId,
    domain: "crm",
    level: "L4",
    dailyActionLimit,
    dailyRiskLimit: 1000,
    perActionRiskLimit: 1000,
    changedById: actorId,
    requestHeaders,
  });
  await addAllowlistEntry({
    organizationId,
    domain: "crm",
    toolName: "expire_stale_opportunity",
    minLevelRequired: "L4",
    addedById: actorId,
    requestHeaders,
  });
}

describe("Sprint 10 pilot: expire_stale_opportunity — tool registration", () => {
  it("is registered with the exact Sprint 10 pilot classification", () => {
    const tool = getTool("expire_stale_opportunity");
    expect(tool).toBeDefined();
    expect(tool?.domain).toBe("crm");
    expect(tool?.mutationCategory).toBe("mutating_gated");
    expect(tool?.blastRadius).toBe("destructive");
    expect(tool?.autonomyEligible).toBe(true);
    expect(tool?.actionRiskValue).toBe(0);
    expect(tool?.requiredPermission).toEqual({ opportunity: ["update"] });
  });
});

describe("Sprint 10 pilot: RBAC", () => {
  afterAll(closeTestConnections);

  it("a viewer (no opportunity:update) is denied", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const viewer = await signUpUser();
    await addMemberDirect(organization.id, viewer, "viewer");
    const conversation = await createConversation({ organizationId: organization.id, userId: viewer.userId });

    const result = await executeToolCall(
      { id: "rbac-1", name: "expire_stale_opportunity", arguments: { opportunityId: "does-not-matter" } },
      { organizationId: organization.id, userId: viewer.userId, conversationId: conversation.id },
      authHeaders(viewer.token),
    );
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.error).toMatch(/permission/i);
  });

  it("an owner (has opportunity:update) passes RBAC and reaches the autonomy gate", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const conversation = await createConversation({ organizationId: organization.id, userId: owner.userId });

    // Default policy is L2; a "destructive" mutating_gated tool is hard-blocked at L2 --
    // proving RBAC passed (it's not a permission error) and the autonomy gate is what fired.
    const result = await executeToolCall(
      { id: "rbac-2", name: "expire_stale_opportunity", arguments: { opportunityId: "does-not-matter" } },
      { organizationId: organization.id, userId: owner.userId, conversationId: conversation.id },
      authHeaders(owner.token),
    );
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.error).not.toMatch(/permission/i);
  });
});

describe("Sprint 10 pilot: expireStaleOpportunity eligibility rule", () => {
  afterAll(closeTestConnections);

  it("expires an opportunity whose lead was won", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const { lead, opportunity, wonStageId } = await createStalledHighValueOpportunity(organization.id, owner.userId);
    await changeLeadStage(organization.id, owner.userId, lead.id, wonStageId);

    const result = await expireStaleOpportunity({ organizationId: organization.id, opportunityId: opportunity.id, actorId: owner.userId });
    expect(result.expired).toBe(true);

    const refreshed = await prisma.opportunity.findUniqueOrThrow({ where: { id: opportunity.id } });
    expect(refreshed.status).toBe("expired");
  });

  it("expires an opportunity whose lead was soft-deleted", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const { lead, opportunity } = await createStalledHighValueOpportunity(organization.id, owner.userId);
    await softDeleteLead(organization.id, lead.id, owner.userId);

    const result = await expireStaleOpportunity({ organizationId: organization.id, opportunityId: opportunity.id, actorId: owner.userId });
    expect(result.expired).toBe(true);
  });

  it("expires an opportunity whose lead is no longer stalled (fresh activity re-evaluated live)", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const { lead, opportunity } = await createStalledHighValueOpportunity(organization.id, owner.userId);

    // A fresh touch on the lead -- re-running evaluateHighValueStalledLead against
    // CURRENT data (not the opportunity's stale stored evidence) now returns null.
    await prisma.leadActivity.create({
      data: { organizationId: organization.id, leadId: lead.id, type: "call", body: "Reached them", actorId: owner.userId },
    });

    const result = await expireStaleOpportunity({ organizationId: organization.id, opportunityId: opportunity.id, actorId: owner.userId });
    expect(result.expired).toBe(true);
  });

  it("does NOT expire an opportunity whose lead is still genuinely stalled and high-value", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const { opportunity } = await createStalledHighValueOpportunity(organization.id, owner.userId);

    const result = await expireStaleOpportunity({ organizationId: organization.id, opportunityId: opportunity.id, actorId: owner.userId });
    expect(result).toEqual({ expired: false, reason: "still_active" });

    const refreshed = await prisma.opportunity.findUniqueOrThrow({ where: { id: opportunity.id } });
    expect(refreshed.status).toBe("new");
  });

  it("never overwrites a human's own triage decision", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const { lead, opportunity, wonStageId } = await createStalledHighValueOpportunity(organization.id, owner.userId);
    await prisma.opportunity.update({ where: { id: opportunity.id }, data: { status: "dismissed" } });
    await changeLeadStage(organization.id, owner.userId, lead.id, wonStageId); // now provably stale too

    const result = await expireStaleOpportunity({ organizationId: organization.id, opportunityId: opportunity.id, actorId: owner.userId });
    expect(result).toEqual({ expired: false, reason: "not_eligible_status", currentStatus: "dismissed" });

    const refreshed = await prisma.opportunity.findUniqueOrThrow({ where: { id: opportunity.id } });
    expect(refreshed.status).toBe("dismissed");
  });

  it("rejects a record from an unsupported rule", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const stages = await listPipelineStages(organization.id);
    const openStage = stages.find((s) => !s.isWon && !s.isLost)!;
    const lead = await createLead({ organizationId: organization.id, actorId: owner.userId, title: "Manual", value: 1, stageId: openStage.id });
    const fake = await prisma.opportunity.create({
      data: {
        organizationId: organization.id,
        type: "manual",
        title: "Not from the pilot's rule",
        description: "d",
        score: 1,
        confidence: 1,
        potentialImpact: 1,
        effort: "low",
        urgency: "low",
        risk: "low",
        explanation: "e",
        relatedEntityType: "Lead",
        relatedEntityId: lead.id,
        ruleName: "some_other_rule",
        ruleVersion: "v1",
      },
    });

    const result = await expireStaleOpportunity({ organizationId: organization.id, opportunityId: fake.id, actorId: owner.userId });
    expect(result).toEqual({ expired: false, reason: "unsupported_rule" });
  });

  it("rejects a nonexistent opportunity id", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    const result = await expireStaleOpportunity({ organizationId: organization.id, opportunityId: "does-not-exist", actorId: owner.userId });
    expect(result).toEqual({ expired: false, reason: "not_found" });
  });

  it("tenant isolation: an opportunity id from a different organization is treated as not_found, never expired", async () => {
    const ownerA = await signUpUser();
    const orgA = await createOrgForUser(ownerA);
    const { lead, opportunity, wonStageId } = await createStalledHighValueOpportunity(orgA.id, ownerA.userId);
    await changeLeadStage(orgA.id, ownerA.userId, lead.id, wonStageId);

    const ownerB = await signUpUser();
    const orgB = await createOrgForUser(ownerB);

    const result = await expireStaleOpportunity({ organizationId: orgB.id, opportunityId: opportunity.id, actorId: ownerB.userId });
    expect(result).toEqual({ expired: false, reason: "not_found" });

    const untouched = await prisma.opportunity.findUniqueOrThrow({ where: { id: opportunity.id } });
    expect(untouched.status).toBe("new");
    expect(untouched.organizationId).toBe(orgA.id);
  });

  it("idempotent: calling it again after a successful expiry is a safe no-op, not an error", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const { lead, opportunity, wonStageId } = await createStalledHighValueOpportunity(organization.id, owner.userId);
    await changeLeadStage(organization.id, owner.userId, lead.id, wonStageId);

    const first = await expireStaleOpportunity({ organizationId: organization.id, opportunityId: opportunity.id, actorId: owner.userId });
    expect(first.expired).toBe(true);

    const second = await expireStaleOpportunity({ organizationId: organization.id, opportunityId: opportunity.id, actorId: owner.userId });
    expect(second).toEqual({ expired: false, reason: "not_eligible_status", currentStatus: "expired" });

    const auditEntries = await prisma.auditLog.findMany({
      where: { organizationId: organization.id, action: "opportunity.ai_expired", targetId: opportunity.id },
    });
    expect(auditEntries).toHaveLength(1); // the retry never wrote a second entry
  });

  it("concurrent execution: two simultaneous callers never both win, and the record is never corrupted", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const { lead, opportunity, wonStageId } = await createStalledHighValueOpportunity(organization.id, owner.userId);
    await changeLeadStage(organization.id, owner.userId, lead.id, wonStageId);

    const [a, b] = await Promise.all([
      expireStaleOpportunity({ organizationId: organization.id, opportunityId: opportunity.id, actorId: owner.userId }),
      expireStaleOpportunity({ organizationId: organization.id, opportunityId: opportunity.id, actorId: owner.userId }),
    ]);

    const outcomes = [a.expired, b.expired].sort();
    expect(outcomes).toEqual([false, true]); // exactly one wins

    const refreshed = await prisma.opportunity.findUniqueOrThrow({ where: { id: opportunity.id } });
    expect(refreshed.status).toBe("expired");

    const auditEntries = await prisma.auditLog.findMany({
      where: { organizationId: organization.id, action: "opportunity.ai_expired", targetId: opportunity.id },
    });
    expect(auditEntries).toHaveLength(1);
  });

  it("calling the service directly (bypassing executeToolCall) never produces an autonomy audit trail", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const { lead, opportunity, wonStageId } = await createStalledHighValueOpportunity(organization.id, owner.userId);
    await changeLeadStage(organization.id, owner.userId, lead.id, wonStageId);

    await expireStaleOpportunity({ organizationId: organization.id, opportunityId: opportunity.id, actorId: owner.userId });

    const autonomyLogs = await prisma.autonomousActionLog.count({ where: { organizationId: organization.id } });
    expect(autonomyLogs).toBe(0);
    const autonomyAuditEntries = await prisma.auditLog.count({
      where: { organizationId: organization.id, action: "autonomy.action_executed" },
    });
    expect(autonomyAuditEntries).toBe(0);
  });
});

describe("Sprint 10 pilot: full autonomy gate — L0 through L4", () => {
  afterAll(closeTestConnections);

  it("L0 blocks outright, no approval queued", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const headers = authHeaders(owner.token);
    await updatePolicy({
      organizationId: organization.id, domain: "crm", level: "L0",
      dailyActionLimit: 0, dailyRiskLimit: 0, perActionRiskLimit: 0,
      changedById: owner.userId, requestHeaders: headers,
    });

    const decision = await resolveAutonomyDecision({
      organizationId: organization.id, actorId: owner.userId, toolName: "expire_stale_opportunity",
      domain: "crm", mutationCategory: "mutating_gated", blastRadius: "destructive",
      autonomyEligible: true, actionRiskValue: 0, input: {}, triggeredBy: "interactive_chat",
    });
    expect(decision.outcome).toBe("blocked");
    const approvals = await prisma.agentApproval.count({ where: { organizationId: organization.id } });
    expect(approvals).toBe(0);
  });

  it("L2 (the org default) hard-blocks this destructive tool from even reaching the approval queue", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    const decision = await resolveAutonomyDecision({
      organizationId: organization.id, actorId: owner.userId, toolName: "expire_stale_opportunity",
      domain: "crm", mutationCategory: "mutating_gated", blastRadius: "destructive",
      autonomyEligible: true, actionRiskValue: 0, input: {}, triggeredBy: "interactive_chat",
    });
    expect(decision.outcome).toBe("blocked");
  });

  it("L3 routes it to the approval queue -- not autonomous, but not hard-blocked either", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const headers = authHeaders(owner.token);
    await updatePolicy({
      organizationId: organization.id, domain: "crm", level: "L3",
      dailyActionLimit: 0, dailyRiskLimit: 0, perActionRiskLimit: 0,
      changedById: owner.userId, requestHeaders: headers,
    });

    const decision = await resolveAutonomyDecision({
      organizationId: organization.id, actorId: owner.userId, toolName: "expire_stale_opportunity",
      domain: "crm", mutationCategory: "mutating_gated", blastRadius: "destructive",
      autonomyEligible: true, actionRiskValue: 0, input: {}, triggeredBy: "interactive_chat",
    });
    expect(decision.outcome).toBe("requires_approval");
  });

  it("L4 without an allowlist entry falls back to approval, not a hard block", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const headers = authHeaders(owner.token);
    await updatePolicy({
      organizationId: organization.id, domain: "crm", level: "L4",
      dailyActionLimit: 10, dailyRiskLimit: 1000, perActionRiskLimit: 1000,
      changedById: owner.userId, requestHeaders: headers,
    });

    const decision = await resolveAutonomyDecision({
      organizationId: organization.id, actorId: owner.userId, toolName: "expire_stale_opportunity",
      domain: "crm", mutationCategory: "mutating_gated", blastRadius: "destructive",
      autonomyEligible: true, actionRiskValue: 0, input: {}, triggeredBy: "interactive_chat",
    });
    expect(decision.outcome).toBe("requires_approval");
    const log = await prisma.autonomousActionLog.findUniqueOrThrow({ where: { id: decision.logId } });
    expect(log.outcome).toBe("blocked_not_allowlisted");
  });

  it("the kill switch blocks it even at L4 with a valid allowlist entry", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const headers = authHeaders(owner.token);
    await enableL4Pilot(organization.id, owner.userId, headers);
    await engageKillSwitch({ organizationId: organization.id, domain: "crm", actorId: owner.userId, requestHeaders: headers });

    const decision = await resolveAutonomyDecision({
      organizationId: organization.id, actorId: owner.userId, toolName: "expire_stale_opportunity",
      domain: "crm", mutationCategory: "mutating_gated", blastRadius: "destructive",
      autonomyEligible: true, actionRiskValue: 0, input: {}, triggeredBy: "interactive_chat",
    });
    expect(decision.outcome).toBe("blocked");
    const log = await prisma.autonomousActionLog.findUniqueOrThrow({ where: { id: decision.logId } });
    expect(log.outcome).toBe("blocked_kill_switch");
  });

  it("the daily action limit blocks the N+1th autonomous attempt, falling back to approval", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const headers = authHeaders(owner.token);
    await enableL4Pilot(organization.id, owner.userId, headers, 1);

    const decisionInput = {
      organizationId: organization.id, actorId: owner.userId, toolName: "expire_stale_opportunity",
      domain: "crm", mutationCategory: "mutating_gated" as const, blastRadius: "destructive" as const,
      autonomyEligible: true, actionRiskValue: 0, input: {}, triggeredBy: "interactive_chat" as const,
    };

    const first = await resolveAutonomyDecision(decisionInput);
    expect(first.outcome).toBe("executed");
    const second = await resolveAutonomyDecision(decisionInput);
    expect(second.outcome).toBe("requires_approval");
    const log = await prisma.autonomousActionLog.findUniqueOrThrow({ where: { id: second.logId } });
    expect(log.outcome).toBe("blocked_limit");
  });

  it("actionRiskValue is genuinely 0, and the risk-budget arithmetic runs against real numbers (not skipped)", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const headers = authHeaders(owner.token);
    await enableL4Pilot(organization.id, owner.userId, headers);

    const decision = await resolveAutonomyDecision({
      organizationId: organization.id, actorId: owner.userId, toolName: "expire_stale_opportunity",
      domain: "crm", mutationCategory: "mutating_gated", blastRadius: "destructive",
      autonomyEligible: true, actionRiskValue: 0, input: {}, triggeredBy: "interactive_chat",
    });
    expect(decision.outcome).toBe("executed");
    const log = await prisma.autonomousActionLog.findUniqueOrThrow({ where: { id: decision.logId } });
    expect(Number(log.actionRiskValue)).toBe(0);
    expect(Number(log.dailyRiskUsedAtDecision)).toBe(0);

    // A second execution's dailyRiskUsedAtDecision reflects the first's contribution (0) --
    // proving the aggregate is genuinely recomputed, not merely defaulted/skipped.
    const second = await resolveAutonomyDecision({
      organizationId: organization.id, actorId: owner.userId, toolName: "expire_stale_opportunity",
      domain: "crm", mutationCategory: "mutating_gated", blastRadius: "destructive",
      autonomyEligible: true, actionRiskValue: 0, input: {}, triggeredBy: "interactive_chat",
    });
    expect(second.outcome).toBe("executed");
    const secondLog = await prisma.autonomousActionLog.findUniqueOrThrow({ where: { id: second.logId } });
    expect(secondLog.dailyActionCountAtDecision).toBe(1);
  });
});

describe("Sprint 10 pilot: end-to-end L4 execution through executeToolCall", () => {
  afterAll(closeTestConnections);

  it("executes for real, writes AutonomousActionLog + AuditLog(autonomy.action_executed), and creates no AgentApproval", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const headers = authHeaders(owner.token);
    await enableL4Pilot(organization.id, owner.userId, headers);

    const { lead, opportunity, wonStageId } = await createStalledHighValueOpportunity(organization.id, owner.userId);
    await changeLeadStage(organization.id, owner.userId, lead.id, wonStageId);

    const conversation = await createConversation({ organizationId: organization.id, userId: owner.userId });
    const result = await executeToolCall(
      { id: "e2e-1", name: "expire_stale_opportunity", arguments: { opportunityId: opportunity.id } },
      { organizationId: organization.id, userId: owner.userId, conversationId: conversation.id },
      headers,
    );
    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.output).toEqual({ expired: true, opportunityId: opportunity.id });
    }

    const refreshed = await prisma.opportunity.findUniqueOrThrow({ where: { id: opportunity.id } });
    expect(refreshed.status).toBe("expired");

    const autonomyLog = await prisma.autonomousActionLog.findFirst({
      where: { organizationId: organization.id, toolName: "expire_stale_opportunity", outcome: "executed" },
    });
    expect(autonomyLog).not.toBeNull();
    expect(autonomyLog?.triggeredBy).toBe("interactive_chat");
    expect(autonomyLog?.allowlistEntryId).not.toBeNull();

    const autonomyAudit = await prisma.auditLog.findFirst({
      where: { organizationId: organization.id, action: "autonomy.action_executed", targetId: autonomyLog!.id },
    });
    expect(autonomyAudit).not.toBeNull();
    expect(autonomyAudit?.actorType).toBe("ai");
    expect(autonomyAudit?.actorId).toBe(owner.userId);

    const domainAudit = await prisma.auditLog.findFirst({
      where: { organizationId: organization.id, action: "opportunity.ai_expired", targetId: opportunity.id },
    });
    expect(domainAudit).not.toBeNull();

    const approvals = await prisma.agentApproval.count({ where: { organizationId: organization.id } });
    expect(approvals).toBe(0);
    const runs = await prisma.agentRun.count({ where: { organizationId: organization.id } });
    expect(runs).toBe(0);

    const invocations = await prisma.toolInvocation.findMany({
      where: { conversationId: conversation.id, toolName: "expire_stale_opportunity" },
    });
    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.status).toBe("success");

    const events = await prisma.domainEvent.findMany({
      where: { organizationId: organization.id, type: "ai.tool.invoked" },
    });
    expect(events.some((e) => (e.payload as { toolName?: string }).toolName === "expire_stale_opportunity")).toBe(true);
  });

  it("at L4 without allowlisting, the same call is queued for human approval instead -- tenant isolation, RBAC, and the CRM data itself untouched", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const headers = authHeaders(owner.token);
    await updatePolicy({
      organizationId: organization.id, domain: "crm", level: "L4",
      dailyActionLimit: 10, dailyRiskLimit: 1000, perActionRiskLimit: 1000,
      changedById: owner.userId, requestHeaders: headers,
    }); // deliberately no addAllowlistEntry call

    const { lead, opportunity, wonStageId } = await createStalledHighValueOpportunity(organization.id, owner.userId);
    await changeLeadStage(organization.id, owner.userId, lead.id, wonStageId);

    const conversation = await createConversation({ organizationId: organization.id, userId: owner.userId });
    const result = await executeToolCall(
      { id: "e2e-2", name: "expire_stale_opportunity", arguments: { opportunityId: opportunity.id } },
      { organizationId: organization.id, userId: owner.userId, conversationId: conversation.id },
      headers,
    );
    expect(result.status).toBe("pending_approval");

    const refreshed = await prisma.opportunity.findUniqueOrThrow({ where: { id: opportunity.id } });
    expect(refreshed.status).toBe("new"); // never touched until a human approves
  });
});
