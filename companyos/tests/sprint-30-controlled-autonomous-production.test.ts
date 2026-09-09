import { execSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import "@/server/ai/tools/builtin";
import { prisma } from "@/server/db/client";
import { getTenantScopedClient } from "@/server/db/tenant";
import { getTool } from "@/server/ai/tools/registry";
import { executeToolCall } from "@/server/ai/tools/executor";
import { createConversation } from "@/server/ai/runtime/conversations";
import { recordSignal } from "@/server/intelligence/signals/service";
import { METRICS_SNAPSHOT_RULE_NAME, METRICS_SNAPSHOT_RULE_VERSION, type MarketMetricsSnapshotPayload } from "@/server/intelligence/signals/market-scanner";
import { STRATEGY_CANDIDATE_RULE_NAME, STRATEGY_CANDIDATE_RULE_VERSION } from "@/server/intelligence/strategy/generate";
import type { StrategyCandidate } from "@/server/intelligence/strategy/types";
import { MIN_SAMPLE_SIZE } from "@/server/intelligence/decision-intelligence/sample-safety";
import { runPaperTradeResult } from "@/server/intelligence/outcome/rules/paper-trade-result";
import { createMockExecutionGateway } from "@/server/execution/mock-gateway";
import { enableAutonomousExecution, getExecutionAutonomyStatus } from "@/server/execution/autonomy-gate";
import { runAutonomousExecutionForOrganization } from "@/server/execution/autonomous-execution";
import { engageKillSwitch, disengageKillSwitch, isKillSwitchEngaged } from "@/server/ai/autonomy/policy-service";
import { setOrganizationCredentials } from "@/server/execution/org-credentials";
import { computeProductionReadiness } from "@/server/execution/production-readiness";
import { closeTestConnections, createClosedPaperTrade, createOrgForUser, signUpUser, authHeaders } from "./helpers";

/**
 * Sprint 30: Controlled Autonomous Production.
 *
 * Audit found the "canonical pipeline" the master prompt asks this sprint
 * to unify already exists and is already unified:
 * `autonomous-execution.ts#runAutonomousExecutionForOrganization` (Sprint
 * 25) already chains LIVE_EXECUTION_ENABLED -> per-org opt-in -> kill
 * switch -> reconciliation -> the Decision Engine -> capital allocation ->
 * submitDecision, and every sprint since (26 quarantine, 27 multi-provider,
 * 28 human controls, 29 read-only observability) composes onto it without
 * needing new wiring. What was genuinely missing was proof: no test yet
 * exercises the pipeline ACROSS sprint boundaries in one real pass. These
 * tests are that proof, not a re-test of any single sprint's own already-
 * covered unit behavior.
 */

const BASE_METRICS: MarketMetricsSnapshotPayload = {
  symbol: "BTCUSDT",
  dailyPercentChange: 5,
  shortTermPercentChange: 1,
  mediumPercentChange: 3,
  trendConsistency: 0.8,
  volumeRatio: 2,
  volatilityPct: 10,
  relativeStrength: 2,
  observedAt: new Date().toISOString(),
  lastClose: 50000,
};

const BASE_CANDIDATE: StrategyCandidate = {
  symbol: "BTCUSDT",
  strategyType: "TREND_FOLLOWING",
  strategyVersion: "v1",
  direction: "up",
  score: 80,
  confidence: 65,
  marketRegime: "trending",
  supportingSignals: ["test supporting signal"],
  contradictingSignals: [],
  thesis: "test thesis",
  entryConditions: ["test entry condition"],
  invalidationConditions: ["test invalidation condition"],
  riskConditions: [],
  expectedScenario: "Hypothetical: riskUnit = 1 test scenario",
  noTradeReason: null,
  riskUnit: 1,
  sourceOpportunityId: null,
  sourceRiskId: null,
  observedAt: BASE_METRICS.observedAt,
};

async function seedActionableDecisionFixtures(organizationId: string): Promise<void> {
  await recordSignal({
    organizationId,
    type: METRICS_SNAPSHOT_RULE_NAME,
    sourceType: "scanner",
    sourceId: `${BASE_METRICS.symbol}:1h`,
    severity: "low",
    confidence: 90,
    ruleName: METRICS_SNAPSHOT_RULE_NAME,
    ruleVersion: METRICS_SNAPSHOT_RULE_VERSION,
    relatedEntityType: "MarketSymbol",
    relatedEntityId: BASE_METRICS.symbol,
    payload: BASE_METRICS,
  });
  await recordSignal({
    organizationId,
    type: STRATEGY_CANDIDATE_RULE_NAME,
    sourceType: "scanner",
    sourceId: `${BASE_CANDIDATE.symbol}:1h`,
    severity: "medium",
    confidence: BASE_CANDIDATE.confidence,
    ruleName: STRATEGY_CANDIDATE_RULE_NAME,
    ruleVersion: STRATEGY_CANDIDATE_RULE_VERSION,
    relatedEntityType: "MarketSymbol",
    relatedEntityId: BASE_CANDIDATE.symbol,
    payload: BASE_CANDIDATE,
  });
  for (let i = 0; i < MIN_SAMPLE_SIZE; i += 1) {
    await createClosedPaperTrade(organizationId, { strategyType: "TREND_FOLLOWING", returnPct: 0.05, candidateConfidence: 85 });
  }
  await runPaperTradeResult(organizationId);
}

async function setupOrg() {
  const owner = await signUpUser();
  const organization = await createOrgForUser(owner);
  return { owner, organization };
}

describe("Sprint 30: Controlled Autonomous Production", () => {
  afterAll(closeTestConnections);

  describe("A. Sprint 26 quarantine composes with the Sprint 25 orchestrator, zero new wiring", () => {
    it("A1: a QUARANTINED strategy type's decision never reaches capital allocation or submitDecision, exactly like a HOLD decision does", async () => {
      const { owner, organization } = await setupOrg();
      await enableAutonomousExecution({ organizationId: organization.id, actorId: owner.userId });
      await seedActionableDecisionFixtures(organization.id);

      const scoped = getTenantScopedClient(organization.id);
      await scoped.strategyHealthState.create({
        data: { organizationId: organization.id, strategyType: "TREND_FOLLOWING", status: "QUARANTINED", reason: "test-seeded quarantine" },
      });

      const gateway = createMockExecutionGateway({ mode: "LIVE" });
      const result = await runAutonomousExecutionForOrganization(organization.id, new Date(), {
        liveExecutionEnabled: true,
        hasLiveCredentials: () => true,
        gateway,
      });

      expect(result.status).toBe("ran");
      if (result.status !== "ran") throw new Error("unreachable");
      expect(result.submitted).toBe(0);
      expect(gateway.submittedIntents).toHaveLength(0);
      const liveOrderCount = await prisma.liveOrder.count({ where: { organizationId: organization.id } });
      expect(liveOrderCount).toBe(0);
    });
  });

  describe("B. a real orchestrator run's LiveOrder is correctly reflected by the Sprint 29 read tool", () => {
    it("B1: after one submitted, FILLED order, get_execution_health reports it -- proving Sprint 29's read path stays connected to Sprint 25's write path", async () => {
      const { owner, organization } = await setupOrg();
      await enableAutonomousExecution({ organizationId: organization.id, actorId: owner.userId });
      await seedActionableDecisionFixtures(organization.id);

      const gateway = createMockExecutionGateway({ mode: "LIVE" });
      const result = await runAutonomousExecutionForOrganization(organization.id, new Date(), {
        liveExecutionEnabled: true,
        hasLiveCredentials: () => true,
        gateway,
      });
      expect(result.status).toBe("ran");
      if (result.status !== "ran") throw new Error("unreachable");
      expect(result.submitted).toBe(1);

      const conversation = await createConversation({ organizationId: organization.id, userId: owner.userId });
      const toolResult = await executeToolCall(
        { id: "eh-1", name: "get_execution_health", arguments: {} },
        { organizationId: organization.id, userId: owner.userId, conversationId: conversation.id },
        authHeaders(owner.token),
      );
      expect(toolResult.status).toBe("success");
      const payload = toolResult as unknown as { output?: { executionQuality?: { totalOrders?: number; filledCount?: number; fillRatePct?: number | null } } };
      expect(payload.output?.executionQuality?.totalOrders).toBe(1);
      expect(payload.output?.executionQuality?.filledCount).toBe(1);
      expect(payload.output?.executionQuality?.fillRatePct).toBe(100);
    });
  });

  describe("C. computeProductionReadiness reflects real, live-changing organization state", () => {
    it("C1: a fresh organization is not ready, for the org-controllable reasons (autonomy not enabled, no credentials) -- kill switch off by default", async () => {
      const { organization } = await setupOrg();
      const readiness = await computeProductionReadiness(organization.id);
      expect(readiness.ready).toBe(false);
      const byKey = Object.fromEntries(readiness.checks.map((c) => [c.key, c.satisfied]));
      expect(byKey.autonomous_execution_enabled).toBe(false);
      expect(byKey.kill_switch_off).toBe(true);
      expect(byKey.credentials_configured).toBe(false);
    });

    it("C2: enabling autonomy, configuring credentials, and leaving the kill switch off flips exactly those three checks -- verified against the SAME functions the orchestrator itself calls", async () => {
      const { owner, organization } = await setupOrg();
      await enableAutonomousExecution({ organizationId: organization.id, actorId: owner.userId });
      await setOrganizationCredentials({ organizationId: organization.id, actorId: owner.userId, apiKey: "test-key", apiSecret: "test-secret" });

      const readiness = await computeProductionReadiness(organization.id);
      const byKey = Object.fromEntries(readiness.checks.map((c) => [c.key, c.satisfied]));
      expect(byKey.autonomous_execution_enabled).toBe(true);
      expect(byKey.kill_switch_off).toBe(true);
      expect(byKey.credentials_configured).toBe(true);

      expect(await getExecutionAutonomyStatus(organization.id)).toMatchObject({ enabled: true });
    });

    it("C3: engaging the market kill switch immediately flips kill_switch_off to false, matching isKillSwitchEngaged directly", async () => {
      const { owner, organization } = await setupOrg();
      const headers = authHeaders(owner.token);
      await engageKillSwitch({ organizationId: organization.id, domain: "market", actorId: owner.userId, requestHeaders: headers });

      const readiness = await computeProductionReadiness(organization.id);
      const byKey = Object.fromEntries(readiness.checks.map((c) => [c.key, c.satisfied]));
      expect(byKey.kill_switch_off).toBe(false);
      expect(await isKillSwitchEngaged(organization.id, "market")).toBe(true);

      await disengageKillSwitch({ organizationId: organization.id, domain: "market", actorId: owner.userId, requestHeaders: headers });
      const readinessAfter = await computeProductionReadiness(organization.id);
      expect(Object.fromEntries(readinessAfter.checks.map((c) => [c.key, c.satisfied])).kill_switch_off).toBe(true);
    });
  });

  describe("D. readiness never produces a false 'ready' -- the deployment-wide switch still governs, exactly as the real orchestrator run confirms", () => {
    it("D1: even with every org-controllable check satisfied, readiness.ready stays false because LIVE_EXECUTION_ENABLED is false in this environment -- and a real (un-overridden) orchestrator run agrees, skipping for the same reason", async () => {
      const { owner, organization } = await setupOrg();
      await enableAutonomousExecution({ organizationId: organization.id, actorId: owner.userId });
      await setOrganizationCredentials({ organizationId: organization.id, actorId: owner.userId, apiKey: "test-key", apiSecret: "test-secret" });

      const readiness = await computeProductionReadiness(organization.id);
      const byKey = Object.fromEntries(readiness.checks.map((c) => [c.key, c.satisfied]));
      expect(byKey.autonomous_execution_enabled).toBe(true);
      expect(byKey.kill_switch_off).toBe(true);
      expect(byKey.credentials_configured).toBe(true);
      expect(byKey.live_execution_enabled).toBe(false);
      expect(readiness.ready).toBe(false);

      // No overrides at all -- this is exactly how the scheduled job calls it in production.
      const result = await runAutonomousExecutionForOrganization(organization.id, new Date());
      expect(result).toEqual({ organizationId: organization.id, status: "skipped", reason: "live_execution_disabled" });
    });
  });

  describe("E. AI restriction", () => {
    it("E1: zero diff in src/server/ai/autonomy/ vs main -- Sprint 30 adds an integration test and a read-only production-readiness composition, nothing else", () => {
      try {
        execSync("git rev-parse --verify origin/main", { cwd: process.cwd(), stdio: "pipe" });
      } catch {
        execSync("git fetch --depth=1 origin main", { cwd: process.cwd(), stdio: "pipe" });
      }
      const diff = execSync("git diff --stat origin/main -- src/server/ai/autonomy/", { cwd: process.cwd(), encoding: "utf-8" });
      expect(diff.trim()).toBe("");
    });

    it("E2: get_execution_health stays read_only and non-autonomy-eligible, and no AI tool imports production-readiness.ts", () => {
      const tool = getTool("get_execution_health");
      expect(tool?.mutationCategory).toBe("read_only");
      expect(tool?.autonomyEligible).toBeFalsy();
      const grep = execSync('grep -rl "production-readiness" src/server/ai/tools/ || true', { cwd: process.cwd(), encoding: "utf-8" });
      expect(grep.trim()).toBe("");
    });
  });
});
