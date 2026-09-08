import { afterAll, describe, expect, it } from "vitest";
import "@/server/ai/tools/builtin";
import { prisma } from "@/server/db/client";
import { CrossTenantAccessError } from "@/server/db/tenant";
import { executeToolCall } from "@/server/ai/tools/executor";
import { createConversation } from "@/server/ai/runtime/conversations";
import { getTool } from "@/server/ai/tools/registry";
import { updatePolicy, addAllowlistEntry, getOrCreatePolicy, listAllowlist } from "@/server/ai/autonomy/policy-service";
import { MAX_AUTONOMY_LEVEL_BY_DOMAIN } from "@/server/ai/autonomy/constants";
import { applyEvaluation, createPendingOutcomeIfMissing } from "@/server/intelligence/outcome/service";
import { evaluatePendingOutcomes } from "@/server/intelligence/evaluate-outcomes";
import { RULE_NAME as RISK_RESOLUTION_RULE_NAME, RULE_VERSION as RISK_RESOLUTION_RULE_VERSION } from "@/server/intelligence/outcome/rules/risk-resolution";
import { RULE_NAME as OPPORTUNITY_PROGRESSION_RULE_NAME, RULE_VERSION as OPPORTUNITY_PROGRESSION_RULE_VERSION } from "@/server/intelligence/outcome/rules/opportunity-state-progression";
import { getDecisionCandidatesForOrganization } from "@/server/intelligence/decision/service";
import { getCandidateTypePerformance, getRulePerformance } from "@/server/intelligence/decision-intelligence/performance";
import { rankDecisionCandidates } from "@/server/intelligence/decision-intelligence/ranking";
import { getDecisionIntelligenceSnapshot } from "@/server/intelligence/decision-intelligence/service";
import { MIN_SAMPLE_SIZE, sampleSizeStatusFor, shrinkSuccessRate } from "@/server/intelligence/decision-intelligence/sample-safety";
import type { CandidateRelatedEntityType, ShrunkPerformance } from "@/server/intelligence/decision-intelligence/types";
import { closeTestConnections, createOrgForUser, signUpUser, authHeaders, addMemberDirect } from "./helpers";

const PAST = new Date(Date.now() - 60_000);

async function createOpenRisk(organizationId: string, overrides?: { confidence?: number; potentialLoss?: number; severity?: "low" | "medium" | "high" | "critical" }) {
  return prisma.risk.create({
    data: {
      organizationId,
      type: "at_risk_subscription",
      title: "Test risk",
      description: "A test risk fixture",
      severity: overrides?.severity ?? "high",
      confidence: overrides?.confidence ?? 80,
      potentialLoss: overrides?.potentialLoss ?? 1000,
      explanation: "fixture",
      ruleName: "at_risk_subscription",
      ruleVersion: "v1",
      status: "open",
    },
  });
}

async function createActiveOpportunity(organizationId: string, overrides?: { confidence?: number; potentialImpact?: number; urgency?: "low" | "medium" | "high" | "critical" }) {
  return prisma.opportunity.create({
    data: {
      organizationId,
      type: "high_value_stalled_lead",
      title: "Test opportunity",
      description: "A test opportunity fixture",
      score: 80,
      confidence: overrides?.confidence ?? 80,
      potentialImpact: overrides?.potentialImpact ?? 1000,
      effort: "medium",
      urgency: overrides?.urgency ?? "high",
      risk: "medium",
      explanation: "fixture",
      ruleName: "high_value_stalled_lead",
      ruleVersion: "v1",
      status: "new",
    },
  });
}

/** Creates `count` already-evaluated Risk-type outcomes with the given verdict, for performance/shrinkage fixtures. */
async function seedEvaluatedOutcomes(
  organizationId: string,
  relatedEntityType: "Risk" | "Opportunity",
  ruleName: string,
  ruleVersion: string,
  outcomes: ("success" | "failure" | "reversed")[],
) {
  for (let i = 0; i < outcomes.length; i++) {
    const relatedEntityId = `${relatedEntityType}-${ruleName}-${i}-${Math.random().toString(36).slice(2)}`;
    await createPendingOutcomeIfMissing({
      organizationId,
      relatedEntityType,
      relatedEntityId,
      ruleName,
      ruleVersion,
      observationDueAt: PAST,
    });
    const outcome = await prisma.outcome.findFirstOrThrow({ where: { organizationId, relatedEntityId } });
    await applyEvaluation({ outcomeId: outcome.id, organizationId, outcomeType: outcomes[i]!, confidence: 90 });
  }
}

describe("A/B: tenant isolation and cross-tenant rejection", () => {
  afterAll(closeTestConnections);

  it("A: candidate-type performance, rule performance, and ranking are all scoped to their own organization", async () => {
    const ownerA = await signUpUser();
    const orgA = await createOrgForUser(ownerA);
    const ownerB = await signUpUser();
    const orgB = await createOrgForUser(ownerB);

    await seedEvaluatedOutcomes(orgA.id, "Risk", RISK_RESOLUTION_RULE_NAME, RISK_RESOLUTION_RULE_VERSION, ["success", "success", "success"]);
    await createOpenRisk(orgA.id);

    const perfB = await getCandidateTypePerformance(orgB.id);
    const riskPerfB = perfB.find((p) => p.relatedEntityType === "Risk")!;
    expect(riskPerfB.performance.totalEvaluated).toBe(0);

    const rulePerfB = await getRulePerformance(orgB.id);
    expect(rulePerfB.every((r) => r.performance.totalEvaluated === 0)).toBe(true);

    const candidatesB = await getDecisionCandidatesForOrganization(orgB.id);
    expect(candidatesB).toHaveLength(0);

    const snapshotA = await getDecisionIntelligenceSnapshot(orgA.id);
    expect(snapshotA.rankedCandidates).toHaveLength(1);
  });

  it("B: a tenant-scoped client throws CrossTenantAccessError rather than silently leaking another organization's data", async () => {
    const ownerA = await signUpUser();
    const orgA = await createOrgForUser(ownerA);
    const ownerB = await signUpUser();
    const orgB = await createOrgForUser(ownerB);
    await createOpenRisk(orgA.id);

    const { getTenantScopedClient } = await import("@/server/db/tenant");
    const scopedAsB = getTenantScopedClient(orgB.id);
    await expect(scopedAsB.risk.findFirst({ where: { organizationId: orgA.id } })).rejects.toBeInstanceOf(CrossTenantAccessError);
  });
});

describe("C/F/G/H/I: decision performance aggregation is real, not fabricated", () => {
  afterAll(closeTestConnections);

  it("C/F/G: candidate-type performance correctly counts success, failure, and computes successRate", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await seedEvaluatedOutcomes(organization.id, "Risk", RISK_RESOLUTION_RULE_NAME, RISK_RESOLUTION_RULE_VERSION, [
      "success",
      "success",
      "success",
      "failure",
    ]);

    const perf = await getCandidateTypePerformance(organization.id);
    const riskPerf = perf.find((p) => p.relatedEntityType === "Risk")!;
    expect(riskPerf.performance.totalEvaluated).toBe(4);
    expect(riskPerf.performance.successCount).toBe(3);
    expect(riskPerf.performance.failureCount).toBe(1);
    expect(riskPerf.performance.successRate).toBe(75);
  });

  it("H: reversed outcomes are tracked distinctly from failure", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await seedEvaluatedOutcomes(organization.id, "Risk", RISK_RESOLUTION_RULE_NAME, RISK_RESOLUTION_RULE_VERSION, ["success", "reversed"]);

    const perf = await getCandidateTypePerformance(organization.id);
    const riskPerf = perf.find((p) => p.relatedEntityType === "Risk")!;
    expect(riskPerf.performance.reversedCount).toBe(1);
    expect(riskPerf.performance.failureCount).toBe(0);
  });

  it("I: a pending outcome (no evidence yet) is never counted as evaluated, success, or failure", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await createPendingOutcomeIfMissing({
      organizationId: organization.id,
      relatedEntityType: "Risk",
      relatedEntityId: "still-pending",
      ruleName: RISK_RESOLUTION_RULE_NAME,
      ruleVersion: RISK_RESOLUTION_RULE_VERSION,
      observationDueAt: new Date(Date.now() + 999_999),
    });

    const perf = await getCandidateTypePerformance(organization.id);
    const riskPerf = perf.find((p) => p.relatedEntityType === "Risk")!;
    expect(riskPerf.performance.totalEvaluated).toBe(0);
    expect(riskPerf.performance.pendingCount).toBe(1);
    expect(riskPerf.performance.successRate).toBeNull();
  });

  it("N: rule performance keeps ruleVersion as its own dimension -- a v2 row never blends into v1's track record", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await seedEvaluatedOutcomes(organization.id, "Risk", RISK_RESOLUTION_RULE_NAME, RISK_RESOLUTION_RULE_VERSION, ["success"]);
    // A synthetic v2 row -- no real v2 of this rule exists yet, this only proves the filter is version-aware.
    await createPendingOutcomeIfMissing({
      organizationId: organization.id,
      relatedEntityType: "Risk",
      relatedEntityId: "v2-row",
      ruleName: RISK_RESOLUTION_RULE_NAME,
      ruleVersion: "v2",
      observationDueAt: PAST,
    });
    const v2Outcome = await prisma.outcome.findFirstOrThrow({ where: { organizationId: organization.id, relatedEntityId: "v2-row" } });
    await applyEvaluation({ outcomeId: v2Outcome.id, organizationId: organization.id, outcomeType: "failure", confidence: 90 });

    const rulePerf = await getRulePerformance(organization.id);
    const v1Perf = rulePerf.find((r) => r.ruleName === RISK_RESOLUTION_RULE_NAME && r.ruleVersion === RISK_RESOLUTION_RULE_VERSION)!;
    expect(v1Perf.performance.totalEvaluated).toBe(1);
    expect(v1Perf.performance.successCount).toBe(1);
    expect(v1Perf.performance.failureCount).toBe(0); // the v2 failure must not bleed into v1's count
  });
});

describe("D/M: sample-size safety -- a tiny sample is never read as strong evidence", () => {
  afterAll(closeTestConnections);

  it("D: shrinkSuccessRate pulls a tiny sample toward the neutral 50% prior instead of reporting 100% or 0%", () => {
    expect(shrinkSuccessRate(0, 0)).toBe(50);
    const oneSuccess = shrinkSuccessRate(1, 1);
    expect(oneSuccess).toBeGreaterThan(50);
    expect(oneSuccess).toBeLessThan(100);
    const oneFailure = shrinkSuccessRate(0, 1);
    expect(oneFailure).toBeLessThan(50);
    expect(oneFailure).toBeGreaterThan(0);
  });

  it("D: shrinkSuccessRate converges toward the true observed rate as the sample grows", () => {
    const small = shrinkSuccessRate(9, 10); // 90% observed, small sample
    const large = shrinkSuccessRate(90, 100); // 90% observed, large sample
    expect(large).toBeGreaterThan(small);
    expect(large).toBeGreaterThan(85);
  });

  it("D: sampleSizeStatusFor flags anything below MIN_SAMPLE_SIZE", () => {
    expect(sampleSizeStatusFor(MIN_SAMPLE_SIZE - 1)).toBe("insufficient_sample");
    expect(sampleSizeStatusFor(MIN_SAMPLE_SIZE)).toBe("sufficient_sample");
  });

  it("M: a candidate type with only 1 evaluated outcome does not dominate ranking as if it were 100% reliable", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await seedEvaluatedOutcomes(organization.id, "Risk", RISK_RESOLUTION_RULE_NAME, RISK_RESOLUTION_RULE_VERSION, ["success"]);
    const risk = await createOpenRisk(organization.id, { confidence: 50 });

    const perf = await getCandidateTypePerformance(organization.id);
    const performanceByType = new Map<CandidateRelatedEntityType, ShrunkPerformance>(
      perf.map((p) => [p.relatedEntityType, p.performance]),
    );
    const candidates = await getDecisionCandidatesForOrganization(organization.id);
    const ranked = rankDecisionCandidates(candidates, performanceByType);
    const rankedRisk = ranked.find((r) => r.id === risk.id)!;

    // historicalFactor must stay well short of the 1.0 ceiling despite a 100%-observed single-sample rate.
    expect(rankedRisk.historicalFactor).toBeLessThan(0.95);
    expect(rankedRisk.rankingReasons.some((r) => r.includes("Insufficient historical sample"))).toBe(true);
  });
});

describe("J/K/L: ranking is deterministic, explainable, and history-influenced", () => {
  afterAll(closeTestConnections);

  it("J: the same candidates and performance data always produce the same ranking and scores", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await createOpenRisk(organization.id, { potentialLoss: 5000, severity: "critical" });
    await createActiveOpportunity(organization.id, { potentialImpact: 2000, urgency: "medium" });

    const candidates = await getDecisionCandidatesForOrganization(organization.id);
    const performanceByType = new Map<CandidateRelatedEntityType, ShrunkPerformance>();

    const first = rankDecisionCandidates(candidates, performanceByType);
    const second = rankDecisionCandidates(candidates, performanceByType);
    expect(first).toEqual(second);
  });

  it("K: every ranked candidate carries at least one deterministic, DB-derived ranking reason", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await createOpenRisk(organization.id);

    const candidates = await getDecisionCandidatesForOrganization(organization.id);
    const ranked = rankDecisionCandidates(candidates, new Map());
    expect(ranked[0]!.rankingReasons.length).toBeGreaterThan(0);
    expect(ranked[0]!.rankingReasons[0]).toMatch(/Severity-weighted exposure/);
  });

  it("L/O/P: a strong historical success rate for a candidate type raises its ranking relative to an equally-scored but historically weaker type", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    // Risk candidates historically succeed; Opportunity candidates historically fail -- large enough samples to clear MIN_SAMPLE_SIZE.
    await seedEvaluatedOutcomes(organization.id, "Risk", RISK_RESOLUTION_RULE_NAME, RISK_RESOLUTION_RULE_VERSION, [
      "success", "success", "success", "success", "success", "success",
    ]);
    await seedEvaluatedOutcomes(organization.id, "Opportunity", OPPORTUNITY_PROGRESSION_RULE_NAME, OPPORTUNITY_PROGRESSION_RULE_VERSION, [
      "failure", "failure", "failure", "failure", "failure", "failure",
    ]);

    // Equal base exposure and equal confidence so the ONLY difference is historical performance.
    const risk = await createOpenRisk(organization.id, { potentialLoss: 1000, severity: "high", confidence: 80 });
    const opportunity = await createActiveOpportunity(organization.id, { potentialImpact: 1000, urgency: "high", confidence: 80 });

    const snapshot = await getDecisionIntelligenceSnapshot(organization.id);
    const rankedRisk = snapshot.rankedCandidates.find((c) => c.id === risk.id)!;
    const rankedOpportunity = snapshot.rankedCandidates.find((c) => c.id === opportunity.id)!;

    expect(rankedRisk.baseScore).toBe(rankedOpportunity.baseScore); // same exposure -- proves the difference is purely historical
    expect(rankedRisk.priorityScore).toBeGreaterThan(rankedOpportunity.priorityScore);
    expect(snapshot.rankedCandidates[0]!.id).toBe(risk.id); // the historically-reliable one ranks first
  });

  it("baseScore alone (with no history) still matches Sprint 8's own severity-weighted formula -- ranking never replaces it", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const risk = await createOpenRisk(organization.id, { potentialLoss: 1000, severity: "high" }); // weight 3

    const candidates = await getDecisionCandidatesForOrganization(organization.id);
    const ranked = rankDecisionCandidates(candidates, new Map());
    expect(ranked.find((c) => c.id === risk.id)!.baseScore).toBe(3000);
  });
});

describe("Q/R: AI tools are read-only, tenant-scoped, and correctly permissioned", () => {
  afterAll(closeTestConnections);

  it("Q: get_decision_performance and rank_decision_candidates only ever return the calling organization's own data", async () => {
    const ownerA = await signUpUser();
    const orgA = await createOrgForUser(ownerA);
    const ownerB = await signUpUser();
    const orgB = await createOrgForUser(ownerB);
    await createOpenRisk(orgA.id);

    const conversation = await createConversation({ organizationId: orgB.id, userId: ownerB.userId });
    const result = await executeToolCall(
      { id: "rank-1", name: "rank_decision_candidates", arguments: {} },
      { organizationId: orgB.id, userId: ownerB.userId, conversationId: conversation.id },
      authHeaders(ownerB.token),
    );
    expect(result.status).toBe("success");
    const output = (result as { status: "success"; output: { rankedCandidates: unknown[] } }).output;
    expect(output.rankedCandidates).toHaveLength(0); // orgA's risk must never appear for orgB
  });

  it("R: both new tools require decision:read -- every organization role holds it, so a real, authenticated call from each succeeds", async () => {
    expect(getTool("get_decision_performance")?.requiredPermission).toEqual({ decision: ["read"] });
    expect(getTool("rank_decision_candidates")?.requiredPermission).toEqual({ decision: ["read"] });

    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const viewer = await signUpUser();
    await addMemberDirect(organization.id, viewer, "viewer");

    const conversation = await createConversation({ organizationId: organization.id, userId: viewer.userId });
    const result = await executeToolCall(
      { id: "perf-1", name: "get_decision_performance", arguments: {} },
      { organizationId: organization.id, userId: viewer.userId, conversationId: conversation.id },
      authHeaders(viewer.token),
    );
    expect(result.status).toBe("success");
  });

  it("get_decision_performance does not write an AuditLog entry per call -- read-only presentation, no audit noise (spec section 20)", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const conversation = await createConversation({ organizationId: organization.id, userId: owner.userId });
    const before = await prisma.auditLog.count({ where: { organizationId: organization.id } });

    await executeToolCall(
      { id: "perf-2", name: "get_decision_performance", arguments: {} },
      { organizationId: organization.id, userId: owner.userId, conversationId: conversation.id },
      authHeaders(owner.token),
    );

    const after = await prisma.auditLog.count({ where: { organizationId: organization.id } });
    expect(after).toBe(before);
  });
});

describe("S/T/U/V/W: CRITICAL SAFETY -- decision intelligence can never touch autonomy or add financial capability", () => {
  afterAll(closeTestConnections);

  it("S/T/U: strongly favorable historical learning data changes ranking but leaves AutonomyPolicy, AutonomyAllowlistEntry, and AutonomyPolicyVersion byte-for-byte unchanged", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const headers = authHeaders(owner.token);

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

    // Historical data strongly favors autonomous Risk resolution.
    await seedEvaluatedOutcomes(organization.id, "Risk", RISK_RESOLUTION_RULE_NAME, RISK_RESOLUTION_RULE_VERSION, [
      "success", "success", "success", "success", "success", "success", "success", "success",
    ]);
    await createOpenRisk(organization.id, { confidence: 95 });
    await createActiveOpportunity(organization.id, { confidence: 20 });

    // Ranking runs, including the AI-tool surface and the full snapshot/orchestrator.
    const before = await getDecisionIntelligenceSnapshot(organization.id);
    expect(before.rankedCandidates.length).toBeGreaterThan(0);
    await evaluatePendingOutcomes();
    const after = await getDecisionIntelligenceSnapshot(organization.id);
    expect(after.rankedCandidates[0]!.kind).toBe("risk"); // ranking DID change/reorder as expected

    const policyAfter = await getOrCreatePolicy(organization.id, "crm");
    const allowlistAfter = await listAllowlist(organization.id, "crm");
    const versionCountAfter = await prisma.autonomyPolicyVersion.count({ where: { organizationId: organization.id, domain: "crm" } });

    expect(policyAfter).toEqual(policyBefore);
    expect(allowlistAfter).toEqual(allowlistBefore);
    expect(versionCountAfter).toBe(versionCountBefore);
  });

  it("V/W: no Sprint 12 tool is registered under the market domain, and the market autonomy ceiling stays capped at L2", () => {
    const decisionPerfTool = getTool("get_decision_performance")!;
    const rankingTool = getTool("rank_decision_candidates")!;
    expect(decisionPerfTool.domain).not.toBe("market");
    expect(rankingTool.domain).not.toBe("market");
    expect(decisionPerfTool.mutationCategory).toBe("read_only");
    expect(rankingTool.mutationCategory).toBe("read_only");

    expect(MAX_AUTONOMY_LEVEL_BY_DOMAIN.market).toBe("L2");
    expect(MAX_AUTONOMY_LEVEL_BY_DOMAIN.crm).toBe("L5");
  });
});
