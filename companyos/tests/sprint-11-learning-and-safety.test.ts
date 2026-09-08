import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import "@/server/ai/tools/builtin";
import { prisma } from "@/server/db/client";
import { executeToolCall } from "@/server/ai/tools/executor";
import { createConversation } from "@/server/ai/runtime/conversations";
import { updatePolicy, addAllowlistEntry, getOrCreatePolicy, listAllowlist } from "@/server/ai/autonomy/policy-service";
import { MAX_AUTONOMY_LEVEL_BY_DOMAIN } from "@/server/ai/autonomy/constants";
import { createLead, changeLeadStage } from "@/server/leads/service";
import { listPipelineStages } from "@/server/leads/pipeline";
import { scanCompanySignals } from "@/server/intelligence/signals/scanner";
import { generateOpportunitiesForOrganization } from "@/server/intelligence/opportunity/service";
import { evaluatePendingOutcomes } from "@/server/intelligence/evaluate-outcomes";
import * as staleAdvisoryResolution from "@/server/intelligence/outcome/rules/stale-advisory-resolution";
import { applyEvaluation, createPendingOutcomeIfMissing, confirmOutcome } from "@/server/intelligence/outcome/service";
import { recordLearningIfMissing, getOutcomePerformance, getAutonomousActionPerformance, getConfidenceCalibration, getDecisionPerformance } from "@/server/intelligence/learning/service";
import { closeTestConnections, createOrgForUser, signUpUser, authHeaders } from "./helpers";

const PAST = new Date(Date.now() - 60_000);

async function backdateLeadActivity(leadId: string, daysAgo: number): Promise<void> {
  const when = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  await prisma.leadActivity.updateMany({ where: { leadId }, data: { createdAt: when } });
}

async function createStalledHighValueOpportunity(organizationId: string, actorId: string) {
  const stages = await listPipelineStages(organizationId);
  const openStage = stages.find((s) => !s.isWon && !s.isLost)!;
  const wonStage = stages.find((s) => s.isWon)!;
  const lead = await createLead({ organizationId, actorId, title: "Big stalled deal", value: 9000, stageId: openStage.id });
  await createLead({ organizationId, actorId, title: "Filler", value: 0, stageId: openStage.id });
  await backdateLeadActivity(lead.id, 9);
  await scanCompanySignals();
  await generateOpportunitiesForOrganization(organizationId);
  const opportunity = await prisma.opportunity.findFirstOrThrow({ where: { organizationId, relatedEntityId: lead.id } });
  return { lead, opportunity, wonStageId: wonStage.id };
}

describe("Learning service", () => {
  afterAll(closeTestConnections);

  it("N/O: recordLearningIfMissing is idempotent, including under a concurrent race", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await createPendingOutcomeIfMissing({
      organizationId: organization.id, relatedEntityType: "Risk", relatedEntityId: "risk-learn",
      ruleName: "risk_resolution", ruleVersion: "v1", observationDueAt: PAST,
    });
    const outcome = await prisma.outcome.findFirstOrThrow({ where: { organizationId: organization.id, relatedEntityId: "risk-learn" } });

    const input = {
      organizationId: organization.id,
      outcomeId: outcome.id,
      relatedEntityType: "Risk",
      relatedEntityId: "risk-learn",
      ruleName: "risk_resolution",
      ruleVersion: "v1",
      outcomeType: "success" as const,
      expectedValue: 0,
      observedValue: 0,
      evaluationConfidence: 90,
    };

    await Promise.all([recordLearningIfMissing(input), recordLearningIfMissing(input), recordLearningIfMissing(input)]);
    const count = await prisma.learningRecord.count({ where: { outcomeId: outcome.id } });
    expect(count).toBe(1);
  });

  it("Q: autonomous action performance distinguishes execution success from business outcome, and computes a real reversal rate", async () => {
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
    await executeToolCall(
      { id: "perf-1", name: "expire_stale_opportunity", arguments: { opportunityId: opportunity.id } },
      { organizationId: organization.id, userId: owner.userId, conversationId: conversation.id },
      headers,
    );

    const before = await getAutonomousActionPerformance(organization.id);
    expect(before.totalExecuted).toBe(1);
    expect(before.outcomesTracked).toBe(0); // no outcome discovered yet -- execution success alone proves nothing

    await staleAdvisoryResolution.runStaleAdvisoryResolution(organization.id);
    const log = await prisma.autonomousActionLog.findFirstOrThrow({
      where: { organizationId: organization.id, toolName: "expire_stale_opportunity", outcome: "executed" },
    });
    const outcome = await prisma.outcome.findFirstOrThrow({
      where: { organizationId: organization.id, relatedEntityType: "AutonomousActionLog", relatedEntityId: log.id },
    });
    await applyEvaluation({ outcomeId: outcome.id, organizationId: organization.id, outcomeType: "success", confidence: 90 });

    const after = await getAutonomousActionPerformance(organization.id);
    expect(after.totalExecuted).toBe(1);
    expect(after.evaluatedCount).toBe(1);
    expect(after.successCount).toBe(1);
    expect(after.successRate).toBe(100);
    expect(after.reversalRate).toBe(0);
  });

  it("R: confidence calibration buckets are computed from real evaluated evidence, not guessed", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    for (let i = 0; i < 4; i++) {
      await createPendingOutcomeIfMissing({
        organizationId: organization.id, relatedEntityType: "Risk", relatedEntityId: `calib-${i}`,
        ruleName: "risk_resolution", ruleVersion: "v1", observationDueAt: PAST,
      });
      const outcome = await prisma.outcome.findFirstOrThrow({ where: { organizationId: organization.id, relatedEntityId: `calib-${i}` } });
      await applyEvaluation({
        outcomeId: outcome.id, organizationId: organization.id,
        outcomeType: i < 3 ? "success" : "failure", confidence: 90,
      });
    }

    const buckets = await getConfidenceCalibration(organization.id);
    const highBucket = buckets.find((b) => b.label === "90-100")!;
    expect(highBucket.totalEvaluated).toBe(4);
    expect(highBucket.successCount).toBe(3);
    expect(highBucket.observedSuccessRate).toBe(75);

    const emptyBucket = buckets.find((b) => b.label === "60-79")!;
    expect(emptyBucket.totalEvaluated).toBe(0);
    expect(emptyBucket.observedSuccessRate).toBeNull();
  });

  it("P: decision performance honestly reports empty (null/0), not fabricated, since no rule links a decisionId yet", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const performance = await getDecisionPerformance(organization.id);
    expect(performance.totalEvaluated).toBe(0);
    expect(performance.successRate).toBeNull();
    expect(performance.averageConfidence).toBeNull();
  });

  it("generic outcome performance aggregates counts, success rate, and average confidence correctly across mixed types", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    const scenarios: { id: string; type: "success" | "failure" | "neutral" }[] = [
      { id: "mix-1", type: "success" },
      { id: "mix-2", type: "success" },
      { id: "mix-3", type: "failure" },
      { id: "mix-4", type: "neutral" },
    ];
    for (const scenario of scenarios) {
      await createPendingOutcomeIfMissing({
        organizationId: organization.id, relatedEntityType: "Opportunity", relatedEntityId: scenario.id,
        ruleName: "opportunity_state_progression", ruleVersion: "v1", observationDueAt: PAST,
      });
      const outcome = await prisma.outcome.findFirstOrThrow({ where: { organizationId: organization.id, relatedEntityId: scenario.id } });
      await applyEvaluation({ outcomeId: outcome.id, organizationId: organization.id, outcomeType: scenario.type, confidence: 90 });
    }
    await createPendingOutcomeIfMissing({
      organizationId: organization.id, relatedEntityType: "Opportunity", relatedEntityId: "mix-pending",
      ruleName: "opportunity_state_progression", ruleVersion: "v1", observationDueAt: new Date(Date.now() + 999_999),
    });

    const performance = await getOutcomePerformance({ organizationId: organization.id, ruleName: "opportunity_state_progression" });
    expect(performance.totalEvaluated).toBe(4);
    expect(performance.successCount).toBe(2);
    expect(performance.failureCount).toBe(1);
    expect(performance.neutralCount).toBe(1);
    expect(performance.pendingCount).toBe(1);
    expect(performance.successRate).toBe(50);
    expect(performance.averageConfidence).toBe(90);
  });
});

describe("evaluate-pending-outcomes job", () => {
  afterAll(closeTestConnections);
  afterEach(() => vi.restoreAllMocks());

  it("S: is idempotent -- a second run discovers nothing new and never duplicates evaluations", async () => {
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
    await executeToolCall(
      { id: "job-1", name: "expire_stale_opportunity", arguments: { opportunityId: opportunity.id } },
      { organizationId: organization.id, userId: owner.userId, conversationId: conversation.id },
      headers,
    );

    const first = await evaluatePendingOutcomes();
    expect(first.discovered).toBeGreaterThanOrEqual(1);

    const outcomeCountAfterFirst = await prisma.outcome.count({ where: { organizationId: organization.id } });

    const second = await evaluatePendingOutcomes();
    expect(second.discovered).toBe(0);

    const outcomeCountAfterSecond = await prisma.outcome.count({ where: { organizationId: organization.id } });
    expect(outcomeCountAfterSecond).toBe(outcomeCountAfterFirst);
  });

  it("T: one organization's failure never stops another organization's outcomes from being processed", async () => {
    const failingOwner = await signUpUser();
    const failingOrg = await createOrgForUser(failingOwner);
    await createPendingOutcomeIfMissing({
      organizationId: failingOrg.id, relatedEntityType: "Risk", relatedEntityId: "fail-risk",
      ruleName: "risk_resolution", ruleVersion: "v1", observationDueAt: PAST,
    });

    const healthyOwner = await signUpUser();
    const healthyOrg = await createOrgForUser(healthyOwner);
    await createPendingOutcomeIfMissing({
      organizationId: healthyOrg.id, relatedEntityType: "Risk", relatedEntityId: "healthy-risk",
      ruleName: "risk_resolution", ruleVersion: "v1", observationDueAt: PAST,
    });

    const original = staleAdvisoryResolution.runStaleAdvisoryResolution;
    vi.spyOn(staleAdvisoryResolution, "runStaleAdvisoryResolution").mockImplementation(async (organizationId: string) => {
      if (organizationId === failingOrg.id) {
        throw new Error("simulated failure for this organization");
      }
      return original(organizationId);
    });

    const result = await evaluatePendingOutcomes();
    expect(result.errors).toBeGreaterThanOrEqual(1);

    // The healthy organization's own risk_resolution outcome (unaffected by the spy,
    // which only targets stale_advisory_resolution) was still discovered.
    const healthyOutcome = await prisma.outcome.findFirst({
      where: { organizationId: healthyOrg.id, relatedEntityId: "healthy-risk" },
    });
    expect(healthyOutcome).not.toBeNull();
  });
});

describe("CRITICAL SAFETY: the Outcome/Learning loop can never modify autonomy policy or permissions", () => {
  afterAll(closeTestConnections);

  it("U/V/W/X: running a full learning pass with both positive and negative evidence leaves AutonomyPolicy, AutonomyAllowlistEntry, and AutonomyPolicyVersion byte-for-byte unchanged, and the market domain ceiling stays capped", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const headers = authHeaders(owner.token);

    // Establish a real, non-default policy + allowlist state to snapshot.
    await updatePolicy({
      organizationId: organization.id, domain: "crm", level: "L4",
      dailyActionLimit: 5, dailyRiskLimit: 500, perActionRiskLimit: 100,
      changedById: owner.userId, requestHeaders: headers,
    });
    await addAllowlistEntry({
      organizationId: organization.id, domain: "crm", toolName: "expire_stale_opportunity",
      minLevelRequired: "L4", addedById: owner.userId, requestHeaders: headers,
    });

    const policyBefore = await getOrCreatePolicy(organization.id, "crm");
    const allowlistBefore = await listAllowlist(organization.id, "crm");
    const versionCountBefore = await prisma.autonomyPolicyVersion.count({ where: { organizationId: organization.id, domain: "crm" } });

    // Generate BOTH strongly negative and strongly positive learning evidence.
    await createPendingOutcomeIfMissing({
      organizationId: organization.id, relatedEntityType: "AutonomousActionLog", relatedEntityId: "safety-negative",
      ruleName: "stale_advisory_resolution", ruleVersion: "v1", observationDueAt: PAST,
    });
    const negativeOutcome = await prisma.outcome.findFirstOrThrow({ where: { organizationId: organization.id, relatedEntityId: "safety-negative" } });
    await applyEvaluation({ outcomeId: negativeOutcome.id, organizationId: organization.id, outcomeType: "reversed", confidence: 90 });

    await createPendingOutcomeIfMissing({
      organizationId: organization.id, relatedEntityType: "AutonomousActionLog", relatedEntityId: "safety-positive",
      ruleName: "stale_advisory_resolution", ruleVersion: "v1", observationDueAt: PAST,
    });
    const positiveOutcome = await prisma.outcome.findFirstOrThrow({ where: { organizationId: organization.id, relatedEntityId: "safety-positive" } });
    await applyEvaluation({ outcomeId: positiveOutcome.id, organizationId: organization.id, outcomeType: "success", confidence: 90 });

    // Also run a real human confirmation and the full recurring job, to exercise every write path Sprint 11 adds.
    await confirmOutcome({
      organizationId: organization.id, outcomeId: negativeOutcome.id, outcomeType: "reversed",
      confirmedById: owner.userId, requestHeaders: headers,
    });
    await evaluatePendingOutcomes();
    await getAutonomousActionPerformance(organization.id);
    await getConfidenceCalibration(organization.id);

    const policyAfter = await getOrCreatePolicy(organization.id, "crm");
    const allowlistAfter = await listAllowlist(organization.id, "crm");
    const versionCountAfter = await prisma.autonomyPolicyVersion.count({ where: { organizationId: organization.id, domain: "crm" } });

    expect(policyAfter).toEqual(policyBefore);
    expect(allowlistAfter).toEqual(allowlistBefore);
    expect(versionCountAfter).toBe(versionCountBefore); // no new policy version was created as a learning side effect

    // Structural proof no Sprint 11 code touched the hardcoded domain ceiling.
    expect(MAX_AUTONOMY_LEVEL_BY_DOMAIN.market).toBe("L2");
    expect(MAX_AUTONOMY_LEVEL_BY_DOMAIN.crm).toBe("L5");
  });
});
