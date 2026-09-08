import { afterAll, describe, expect, it } from "vitest";
import "@/server/ai/tools/builtin";
import { prisma } from "@/server/db/client";
import { executeToolCall } from "@/server/ai/tools/executor";
import { createConversation } from "@/server/ai/runtime/conversations";
import { updatePolicy, addAllowlistEntry } from "@/server/ai/autonomy/policy-service";
import { createLead, changeLeadStage, softDeleteLead } from "@/server/leads/service";
import { listPipelineStages } from "@/server/leads/pipeline";
import { scanCompanySignals } from "@/server/intelligence/signals/scanner";
import { generateOpportunitiesForOrganization, expireStaleOpportunity } from "@/server/intelligence/opportunity/service";
import { runStaleAdvisoryResolution } from "@/server/intelligence/outcome/rules/stale-advisory-resolution";
import { runRiskResolution } from "@/server/intelligence/outcome/rules/risk-resolution";
import { runOpportunityStateProgression } from "@/server/intelligence/outcome/rules/opportunity-state-progression";
import { closeTestConnections, createOrgForUser, signUpUser, authHeaders } from "./helpers";

async function backdateLeadActivity(leadId: string, daysAgo: number): Promise<void> {
  const when = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  await prisma.leadActivity.updateMany({ where: { leadId }, data: { createdAt: when } });
}

async function createStalledHighValueOpportunity(organizationId: string, actorId: string) {
  const stages = await listPipelineStages(organizationId);
  const openStage = stages.find((s) => !s.isWon && !s.isLost)!;
  const wonStage = stages.find((s) => s.isWon)!;
  const lostStage = stages.find((s) => s.isLost)!;

  const lead = await createLead({ organizationId, actorId, title: "Big stalled deal", value: 9000, stageId: openStage.id });
  await createLead({ organizationId, actorId, title: "Filler", value: 0, stageId: openStage.id });
  await backdateLeadActivity(lead.id, 9);

  await scanCompanySignals();
  await generateOpportunitiesForOrganization(organizationId);
  const opportunity = await prisma.opportunity.findFirstOrThrow({ where: { organizationId, relatedEntityId: lead.id } });

  return { lead, opportunity, wonStageId: wonStage.id, lostStageId: lostStage.id };
}

async function makePastDue(outcomeId: string): Promise<void> {
  await prisma.outcome.update({ where: { id: outcomeId }, data: { observationDueAt: new Date(Date.now() - 60_000) } });
}

describe("stale_advisory_resolution.v1", () => {
  afterAll(closeTestConnections);

  it("discovers a pending outcome for a real executed autonomous action, then evaluates to success once due (the expiry stuck)", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const headers = authHeaders(owner.token);
    await updatePolicy({
      organizationId: organization.id, domain: "crm", level: "L4",
      dailyActionLimit: 10, dailyRiskLimit: 1000, perActionRiskLimit: 1000,
      changedById: owner.userId, requestHeaders: headers,
    });
    await addAllowlistEntry({
      organizationId: organization.id, domain: "crm", toolName: "expire_stale_opportunity",
      minLevelRequired: "L4", addedById: owner.userId, requestHeaders: headers,
    });

    const { lead, opportunity, wonStageId } = await createStalledHighValueOpportunity(organization.id, owner.userId);
    await changeLeadStage(organization.id, owner.userId, lead.id, wonStageId);

    const conversation = await createConversation({ organizationId: organization.id, userId: owner.userId });
    const result = await executeToolCall(
      { id: "rule-1", name: "expire_stale_opportunity", arguments: { opportunityId: opportunity.id } },
      { organizationId: organization.id, userId: owner.userId, conversationId: conversation.id },
      headers,
    );
    expect(result.status).toBe("success");

    const firstPass = await runStaleAdvisoryResolution(organization.id);
    expect(firstPass.discovered).toBe(1);
    expect(firstPass.evaluated).toBe(0); // not due yet (24h observation window)

    const outcome = await prisma.outcome.findFirstOrThrow({
      where: { organizationId: organization.id, relatedEntityType: "AutonomousActionLog" },
    });
    expect(outcome.evaluationStatus).toBe("pending");
    await makePastDue(outcome.id);

    const secondPass = await runStaleAdvisoryResolution(organization.id);
    expect(secondPass.discovered).toBe(0); // already tracked -- idempotent discovery
    expect(secondPass.evaluated).toBe(1);

    const evaluated = await prisma.outcome.findUniqueOrThrow({ where: { id: outcome.id } });
    expect(evaluated.evaluationStatus).toBe("evaluated");
    expect(evaluated.outcomeType).toBe("success");
    expect(evaluated.confidence).toBe(90);
  });

  it("evaluates to insufficient_evidence when the referenced opportunity is missing from the log's own input", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    const log = await prisma.autonomousActionLog.create({
      data: {
        organizationId: organization.id,
        domain: "crm",
        toolName: "expire_stale_opportunity",
        level: "L4",
        outcome: "executed",
        input: {},
        dailyActionCountAtDecision: 0,
        dailyRiskUsedAtDecision: 0,
        triggeredBy: "interactive_chat",
      },
    });

    await runStaleAdvisoryResolution(organization.id);
    const outcome = await prisma.outcome.findFirstOrThrow({
      where: { organizationId: organization.id, relatedEntityType: "AutonomousActionLog", relatedEntityId: log.id },
    });
    await makePastDue(outcome.id);

    const pass = await runStaleAdvisoryResolution(organization.id);
    expect(pass.insufficientEvidence).toBe(1);

    const refreshed = await prisma.outcome.findUniqueOrThrow({ where: { id: outcome.id } });
    expect(refreshed.evaluationStatus).toBe("insufficient_evidence");
    expect(refreshed.outcomeType).toBeNull();
  });
});

async function createResolvedRiskWithSignal(
  organizationId: string,
  severity: "low" | "medium" | "high" | "critical",
) {
  const signal = await prisma.companySignal.create({
    data: {
      organizationId,
      type: "billing.subscription_updated",
      sourceType: "domain_event",
      sourceId: `sub-${Math.random().toString(36).slice(2)}`,
      severity,
      confidence: 90,
      ruleName: "at_risk_subscription",
      ruleVersion: "v1",
      relatedEntityType: "Subscription",
      relatedEntityId: "sub-fixture",
      status: "active",
    },
  });
  const risk = await prisma.risk.create({
    data: {
      organizationId,
      type: "at_risk_subscription",
      title: "Subscription at risk",
      description: "fixture",
      severity: "high",
      confidence: 90,
      potentialLoss: 500,
      explanation: "fixture",
      relatedEntityType: "Subscription",
      relatedEntityId: "sub-fixture",
      sourceSignalId: signal.id,
      status: "resolved",
      resolvedAt: new Date(),
      ruleName: "at_risk_subscription",
      ruleVersion: "v1",
    },
  });
  return { signal, risk };
}

describe("risk_resolution.v1", () => {
  afterAll(closeTestConnections);

  it("evaluates to success when the underlying signal stayed healthy", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const { risk } = await createResolvedRiskWithSignal(organization.id, "low");

    await runRiskResolution(organization.id);
    const outcome = await prisma.outcome.findFirstOrThrow({
      where: { organizationId: organization.id, relatedEntityType: "Risk", relatedEntityId: risk.id },
    });
    await makePastDue(outcome.id);

    const pass = await runRiskResolution(organization.id);
    expect(pass.evaluated).toBe(1);

    const evaluated = await prisma.outcome.findUniqueOrThrow({ where: { id: outcome.id } });
    expect(evaluated.outcomeType).toBe("success");

    const learning = await prisma.learningRecord.findUnique({ where: { outcomeId: outcome.id } });
    expect(learning?.outcomeType).toBe("success");
    expect(Number(learning?.expectedValue)).toBe(0);
    expect(Number(learning?.observedValue)).toBe(0);
    expect(Number(learning?.errorValue)).toBe(0);
  });

  it("evaluates to reversed when the signal relapsed to high severity, even though Risk.status still says resolved", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const { signal, risk } = await createResolvedRiskWithSignal(organization.id, "low");

    await runRiskResolution(organization.id);
    const outcome = await prisma.outcome.findFirstOrThrow({
      where: { organizationId: organization.id, relatedEntityType: "Risk", relatedEntityId: risk.id },
    });
    await makePastDue(outcome.id);

    // The signal relapses -- Risk.status is never flipped back by the existing Risk engine (verified by inspection).
    await prisma.companySignal.update({ where: { id: signal.id }, data: { severity: "high" } });

    await runRiskResolution(organization.id);
    const evaluated = await prisma.outcome.findUniqueOrThrow({ where: { id: outcome.id } });
    expect(evaluated.outcomeType).toBe("reversed");

    const stillResolvedInSchema = await prisma.risk.findUniqueOrThrow({ where: { id: risk.id } });
    expect(stillResolvedInSchema.status).toBe("resolved"); // confirms the Risk engine's own behavior is untouched

    const learning = await prisma.learningRecord.findUnique({ where: { outcomeId: outcome.id } });
    expect(Number(learning?.observedValue)).toBe(500);
    expect(Number(learning?.errorValue)).toBe(500);
  });

  it("evaluates to insufficient_evidence when the source signal no longer exists", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const { signal, risk } = await createResolvedRiskWithSignal(organization.id, "low");

    await runRiskResolution(organization.id);
    const outcome = await prisma.outcome.findFirstOrThrow({
      where: { organizationId: organization.id, relatedEntityType: "Risk", relatedEntityId: risk.id },
    });
    await makePastDue(outcome.id);
    await prisma.companySignal.delete({ where: { id: signal.id } });

    const pass = await runRiskResolution(organization.id);
    expect(pass.insufficientEvidence).toBe(1);
  });
});

describe("opportunity_state_progression.v1", () => {
  afterAll(closeTestConnections);

  it("evaluates to success when the flagged lead converts (won)", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const { lead, opportunity, wonStageId } = await createStalledHighValueOpportunity(organization.id, owner.userId);

    await runOpportunityStateProgression(organization.id);
    const outcome = await prisma.outcome.findFirstOrThrow({
      where: { organizationId: organization.id, relatedEntityType: "Opportunity", relatedEntityId: opportunity.id },
    });
    expect(outcome.evaluationStatus).toBe("pending");

    await changeLeadStage(organization.id, owner.userId, lead.id, wonStageId);
    await runOpportunityStateProgression(organization.id);

    const evaluated = await prisma.outcome.findUniqueOrThrow({ where: { id: outcome.id } });
    expect(evaluated.outcomeType).toBe("success");

    const learning = await prisma.learningRecord.findUnique({ where: { outcomeId: outcome.id } });
    expect(Number(learning?.expectedValue)).toBe(9000);
    expect(Number(learning?.observedValue)).toBe(9000);
    expect(Number(learning?.errorValue)).toBe(0);
  });

  it("evaluates to failure when the flagged lead is lost", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const { lead, opportunity, lostStageId } = await createStalledHighValueOpportunity(organization.id, owner.userId);

    await runOpportunityStateProgression(organization.id);
    await changeLeadStage(organization.id, owner.userId, lead.id, lostStageId);
    await runOpportunityStateProgression(organization.id);

    const outcome = await prisma.outcome.findFirstOrThrow({
      where: { organizationId: organization.id, relatedEntityType: "Opportunity", relatedEntityId: opportunity.id },
    });
    expect(outcome.outcomeType).toBe("failure");

    const learning = await prisma.learningRecord.findUnique({ where: { outcomeId: outcome.id } });
    expect(Number(learning?.observedValue)).toBe(0);
    expect(Number(learning?.errorValue)).toBe(-9000);
  });

  it("evaluates to neutral when the opportunity ages out (expired) while the lead is still open", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const { lead, opportunity } = await createStalledHighValueOpportunity(organization.id, owner.userId);

    await runOpportunityStateProgression(organization.id);

    // A fresh touch makes the lead no longer stalled -- expireStaleOpportunity's own
    // deterministic re-check now finds it genuinely stale-and-irrelevant.
    await prisma.leadActivity.create({
      data: { organizationId: organization.id, leadId: lead.id, type: "call", body: "touched", actorId: owner.userId },
    });
    const expireResult = await expireStaleOpportunity({ organizationId: organization.id, opportunityId: opportunity.id, actorId: owner.userId });
    expect(expireResult.expired).toBe(true);

    await runOpportunityStateProgression(organization.id);
    const outcome = await prisma.outcome.findFirstOrThrow({
      where: { organizationId: organization.id, relatedEntityType: "Opportunity", relatedEntityId: opportunity.id },
    });
    expect(outcome.outcomeType).toBe("neutral");
  });

  it("evaluates to neutral when a human dismisses the opportunity while the lead is still open", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const { opportunity } = await createStalledHighValueOpportunity(organization.id, owner.userId);

    await runOpportunityStateProgression(organization.id);
    await prisma.opportunity.update({ where: { id: opportunity.id }, data: { status: "dismissed" } });
    await runOpportunityStateProgression(organization.id);

    const outcome = await prisma.outcome.findFirstOrThrow({
      where: { organizationId: organization.id, relatedEntityType: "Opportunity", relatedEntityId: opportunity.id },
    });
    expect(outcome.outcomeType).toBe("neutral");
  });

  it("stays genuinely pending while the lead is still open and unresolved -- never guessed at", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await createStalledHighValueOpportunity(organization.id, owner.userId);

    await runOpportunityStateProgression(organization.id);
    await runOpportunityStateProgression(organization.id); // idempotent re-run changes nothing

    const outcome = await prisma.outcome.findFirstOrThrow({ where: { organizationId: organization.id, relatedEntityType: "Opportunity" } });
    expect(outcome.evaluationStatus).toBe("pending");
    expect(outcome.outcomeType).toBeNull();
  });

  it("evaluates to insufficient_evidence when the referenced lead is soft-deleted", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const { lead, opportunity } = await createStalledHighValueOpportunity(organization.id, owner.userId);

    await runOpportunityStateProgression(organization.id);
    await softDeleteLead(organization.id, lead.id, owner.userId);
    await runOpportunityStateProgression(organization.id);

    const outcome = await prisma.outcome.findFirstOrThrow({
      where: { organizationId: organization.id, relatedEntityType: "Opportunity", relatedEntityId: opportunity.id },
    });
    expect(outcome.evaluationStatus).toBe("insufficient_evidence");
  });
});
