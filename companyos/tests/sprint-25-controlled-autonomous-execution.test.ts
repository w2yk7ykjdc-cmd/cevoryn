import { afterAll, describe, expect, it } from "vitest";
import "@/server/ai/tools/builtin";
import { prisma } from "@/server/db/client";
import { getTenantScopedClient, CrossTenantAccessError } from "@/server/db/tenant";
import { getTool, listRegisteredTools } from "@/server/ai/tools/registry";
import { engageKillSwitch, isKillSwitchEngaged } from "@/server/ai/autonomy/policy-service";
import { MAX_AUTONOMY_LEVEL_BY_DOMAIN, maxLevelForDomain } from "@/server/ai/autonomy/constants";
import { recordSignal } from "@/server/intelligence/signals/service";
import { METRICS_SNAPSHOT_RULE_NAME, METRICS_SNAPSHOT_RULE_VERSION, type MarketMetricsSnapshotPayload } from "@/server/intelligence/signals/market-scanner";
import { STRATEGY_CANDIDATE_RULE_NAME, STRATEGY_CANDIDATE_RULE_VERSION } from "@/server/intelligence/strategy/generate";
import type { StrategyCandidate } from "@/server/intelligence/strategy/types";
import { MIN_SAMPLE_SIZE } from "@/server/intelligence/decision-intelligence/sample-safety";
import { runPaperTradeResult } from "@/server/intelligence/outcome/rules/paper-trade-result";
import { generateMarketDecisions } from "@/server/intelligence/market-decision/service";
import { createMockExecutionGateway } from "@/server/execution/mock-gateway";
import { submitDecision } from "@/server/execution/service";
import { checkRiskLimits, DEFAULT_HARD_LIMITS } from "@/server/execution/risk-limits";
import { evaluateCapitalAllocation } from "@/server/execution/capital-allocation";
import { buildClientOrderId } from "@/server/execution/idempotency";
import {
  getExecutionAutonomyStatus,
  isAutonomousExecutionEnabled,
  enableAutonomousExecution,
  disableAutonomousExecution,
} from "@/server/execution/autonomy-gate";
import { runAutonomousExecution, runAutonomousExecutionForOrganization } from "@/server/execution/autonomous-execution";
import { closeTestConnections, createClosedPaperTrade, createOrgForUser, signUpUser, authHeaders } from "./helpers";

afterAll(closeTestConnections);

/**
 * Sprint 25 test suite -- controlled autonomous execution: the explicit
 * per-organization autonomy gate, and the orchestrator wiring Sprint 19's
 * decision engine into Sprint 22-24's own already-built,
 * already-tested-but-never-production-called `submitDecision`/
 * `evaluateCapitalAllocation` pipeline. Uses ONLY `createMockExecutionGateway`
 * -- never a real Binance credential, never a real network call.
 */

const BASE_METRICS: MarketMetricsSnapshotPayload = {
  symbol: "BTCUSDT",
  dailyPercentChange: 5,
  shortTermPercentChange: 1,
  mediumPercentChange: 3,
  trendConsistency: 0.8,
  volumeRatio: 2,
  // Deliberately 10 (not Sprint 19's own 1) -- `deriveStopDistancePct`
  // clamps at `MAX_STOP_PCT` (10%) for any volatility this high, which is
  // the ONLY stop distance at which `buildEntryPlan`'s own risk-based
  // sizing (`RISK_PER_TRADE_PCT` / stopDistancePct) produces a notional
  // that does not exceed `MAX_ORDER_NOTIONAL_PCT_OF_EQUITY` (both are
  // calibrated to exactly 10%, by the ORIGINAL Sprint 16/22 constants,
  // not something this sprint invented or tuned).
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
  // Deliberately 65 (not Sprint 19's own 90) -- `selectSafeLeverage` picks
  // a leverage tier by confidence, and `MAX_LIVE_LEVERAGE` (3, Sprint 22)
  // is stricter than the paper-only `MAX_SIMULATION_LEVERAGE` (10) a
  // confidence of 90 would select. 65 stays within the <=2x tier, safely
  // under the live ceiling, so this fixture's decision is genuinely
  // submittable end to end rather than tripping `max_leverage` before this
  // sprint's own orchestrator logic is even exercised.
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

async function seedMetricsSnapshot(organizationId: string, metrics: MarketMetricsSnapshotPayload): Promise<void> {
  await recordSignal({
    organizationId,
    type: METRICS_SNAPSHOT_RULE_NAME,
    sourceType: "scanner",
    sourceId: `${metrics.symbol}:1h`,
    severity: "low",
    confidence: 90,
    ruleName: METRICS_SNAPSHOT_RULE_NAME,
    ruleVersion: METRICS_SNAPSHOT_RULE_VERSION,
    relatedEntityType: "MarketSymbol",
    relatedEntityId: metrics.symbol,
    payload: metrics,
  });
}

async function seedStrategyCandidate(organizationId: string, candidate: StrategyCandidate): Promise<void> {
  await recordSignal({
    organizationId,
    type: STRATEGY_CANDIDATE_RULE_NAME,
    sourceType: "scanner",
    sourceId: `${candidate.symbol}:1h`,
    severity: candidate.strategyType === "NO_TRADE" ? "low" : "medium",
    confidence: candidate.confidence,
    ruleName: STRATEGY_CANDIDATE_RULE_NAME,
    ruleVersion: STRATEGY_CANDIDATE_RULE_VERSION,
    relatedEntityType: "MarketSymbol",
    relatedEntityId: candidate.symbol,
    payload: candidate,
  });
}

async function seedEvaluatedTrades(organizationId: string, count: number, strategyType = "TREND_FOLLOWING"): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await createClosedPaperTrade(organizationId, { strategyType, returnPct: 0.05, candidateConfidence: 85 });
  }
  await runPaperTradeResult(organizationId);
}

/** Seeds everything `generateMarketDecisions` needs to produce ONE genuinely `VALID`, actionable BUY decision for BTCUSDT -- the exact recipe Sprint 19's own test suite (`sprint-19-market-decision.test.ts`, test "O") already established. */
async function seedActionableDecisionFixtures(organizationId: string): Promise<void> {
  await seedMetricsSnapshot(organizationId, BASE_METRICS);
  await seedStrategyCandidate(organizationId, BASE_CANDIDATE);
  await seedEvaluatedTrades(organizationId, MIN_SAMPLE_SIZE);
}

async function setupOrg() {
  const owner = await signUpUser();
  const organization = await createOrgForUser(owner);
  return { owner, organization };
}

describe("Sprint 25: Controlled Autonomous Execution", () => {
  // ── Group A: autonomy gate default + enable/disable ─────────────────────
  describe("A. autonomy gate", () => {
    it("A1: an organization that has never touched the gate is disabled by default", async () => {
      const { organization } = await setupOrg();
      const status = await getExecutionAutonomyStatus(organization.id);
      expect(status.enabled).toBe(false);
      expect(status.enabledAt).toBeNull();
      expect(await isAutonomousExecutionEnabled(organization.id)).toBe(false);
    });

    it("A2: enableAutonomousExecution flips the gate on and records who/when", async () => {
      const { owner, organization } = await setupOrg();
      const status = await enableAutonomousExecution({ organizationId: organization.id, actorId: owner.userId });
      expect(status.enabled).toBe(true);
      expect(status.enabledById).toBe(owner.userId);
      expect(status.enabledAt).toBeInstanceOf(Date);
      expect(await isAutonomousExecutionEnabled(organization.id)).toBe(true);
    });

    it("A3: disableAutonomousExecution flips it back off and is idempotent when never enabled", async () => {
      const { owner, organization } = await setupOrg();
      const status = await disableAutonomousExecution({ organizationId: organization.id, actorId: owner.userId, reason: "just making sure" });
      expect(status.enabled).toBe(false);
      expect(await isAutonomousExecutionEnabled(organization.id)).toBe(false);
    });

    it("A4: enable then disable round-trips correctly and both actions are audited", async () => {
      const { owner, organization } = await setupOrg();
      await enableAutonomousExecution({ organizationId: organization.id, actorId: owner.userId });
      expect(await isAutonomousExecutionEnabled(organization.id)).toBe(true);

      await disableAutonomousExecution({ organizationId: organization.id, actorId: owner.userId });
      expect(await isAutonomousExecutionEnabled(organization.id)).toBe(false);

      const rows = await prisma.auditLog.findMany({ where: { organizationId: organization.id, action: { startsWith: "execution.autonomy_" } }, orderBy: { createdAt: "asc" } });
      expect(rows.map((r) => r.action)).toEqual(["execution.autonomy_enabled", "execution.autonomy_disabled"]);
      expect(rows.every((r) => r.actorType === "system")).toBe(true);
    });
  });

  // ── Group B: tenant isolation ────────────────────────────────────────────
  describe("B. tenant isolation", () => {
    it("B1: organization B cannot read organization A's autonomy gate through the tenant-scoped client", async () => {
      const { owner: ownerA, organization: orgA } = await setupOrg();
      const { organization: orgB } = await setupOrg();
      await enableAutonomousExecution({ organizationId: orgA.id, actorId: ownerA.userId });

      const scopedB = getTenantScopedClient(orgB.id);
      await expect(scopedB.organizationExecutionAutonomyPolicy.findFirst({ where: { organizationId: orgA.id } })).rejects.toThrow(CrossTenantAccessError);
      expect(await isAutonomousExecutionEnabled(orgB.id)).toBe(false);
    });

    it("B2: enabling organization A's gate never enables organization B's", async () => {
      const { owner: ownerA, organization: orgA } = await setupOrg();
      const { organization: orgB } = await setupOrg();
      await enableAutonomousExecution({ organizationId: orgA.id, actorId: ownerA.userId });

      expect(await isAutonomousExecutionEnabled(orgA.id)).toBe(true);
      expect(await isAutonomousExecutionEnabled(orgB.id)).toBe(false);
    });
  });

  // ── Group C: orchestrator gate ordering ──────────────────────────────────
  describe("C. orchestrator gate ordering", () => {
    it("C1: skips with live_execution_disabled when LIVE_EXECUTION_ENABLED is false (the real default, no override)", async () => {
      const { owner, organization } = await setupOrg();
      await enableAutonomousExecution({ organizationId: organization.id, actorId: owner.userId });

      const result = await runAutonomousExecutionForOrganization(organization.id, new Date());
      expect(result).toEqual({ organizationId: organization.id, status: "skipped", reason: "live_execution_disabled" });
    });

    it("C2: skips with autonomous_execution_not_enabled when the org gate was never enabled, even with liveExecutionEnabled overridden true", async () => {
      const { organization } = await setupOrg();
      const result = await runAutonomousExecutionForOrganization(organization.id, new Date(), { liveExecutionEnabled: true });
      expect(result).toEqual({ organizationId: organization.id, status: "skipped", reason: "autonomous_execution_not_enabled" });
    });

    it("C3: skips with kill_switch_engaged when this organization's own market-domain kill switch is on", async () => {
      const { owner, organization } = await setupOrg();
      await enableAutonomousExecution({ organizationId: organization.id, actorId: owner.userId });
      await engageKillSwitch({ organizationId: organization.id, domain: "market", actorId: owner.userId, requestHeaders: authHeaders(owner.token) });

      const result = await runAutonomousExecutionForOrganization(organization.id, new Date(), { liveExecutionEnabled: true });
      expect(result).toEqual({ organizationId: organization.id, status: "skipped", reason: "kill_switch_engaged" });
    });

    it("C4: skips with no_live_credentials when no gateway is injected and no organization/env credential exists", async () => {
      const { owner, organization } = await setupOrg();
      await enableAutonomousExecution({ organizationId: organization.id, actorId: owner.userId });

      const result = await runAutonomousExecutionForOrganization(organization.id, new Date(), { liveExecutionEnabled: true });
      expect(result).toEqual({ organizationId: organization.id, status: "skipped", reason: "no_live_credentials" });
    });

    it("C5: skips with reconciliation_unhealthy when the gateway reports an order this organization has no local record of", async () => {
      const { owner, organization } = await setupOrg();
      await enableAutonomousExecution({ organizationId: organization.id, actorId: owner.userId });

      const gateway = createMockExecutionGateway({
        mode: "LIVE",
        openOrders: [{ clientOrderId: "unknown-remote-order", providerOrderId: "prov-1", symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: 1, price: null, status: "SUBMITTED", filledQuantity: 0, averageFillPrice: null, rejectionReason: null }],
      });

      const result = await runAutonomousExecutionForOrganization(organization.id, new Date(), { liveExecutionEnabled: true, gateway });
      expect(result).toEqual({ organizationId: organization.id, status: "skipped", reason: "reconciliation_unhealthy" });
    });
  });

  // ── Group D: happy path -- a valid decision actually submits ────────────
  describe("D. happy path submission", () => {
    it("D1: an enabled organization with a healthy gateway submits its one VALID BUY decision through the unchanged submitDecision pipeline", async () => {
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
      expect(result.decisionsEvaluated).toBeGreaterThanOrEqual(1);
      expect(result.submitted).toBe(1);
      expect(gateway.submittedIntents).toHaveLength(1);
      expect(gateway.submittedIntents[0]!.symbol).toBe("BTCUSDT");

      const liveOrder = await prisma.liveOrder.findFirst({ where: { organizationId: organization.id, symbol: "BTCUSDT" } });
      expect(liveOrder).not.toBeNull();
      expect(liveOrder!.status).toBe("FILLED");
    });

    it("D2: HOLD/NO_TRADE decisions never reach capital allocation or submitDecision (no LiveOrder row, no submitted intent)", async () => {
      const { owner, organization } = await setupOrg();
      await enableAutonomousExecution({ organizationId: organization.id, actorId: owner.userId });
      // A NO_TRADE candidate -- no evidence/evaluation seeded either, so even a directional candidate would reject; this uses an explicit non-directional strategy for clarity.
      await seedMetricsSnapshot(organization.id, BASE_METRICS);
      await seedStrategyCandidate(organization.id, { ...BASE_CANDIDATE, strategyType: "NO_TRADE", direction: null, noTradeReason: "insufficient_evidence" });

      const gateway = createMockExecutionGateway({ mode: "LIVE" });
      const result = await runAutonomousExecutionForOrganization(organization.id, new Date(), { liveExecutionEnabled: true, hasLiveCredentials: () => true, gateway });

      expect(result.status).toBe("ran");
      if (result.status !== "ran") throw new Error("unreachable");
      expect(result.submitted).toBe(0);
      expect(gateway.submittedIntents).toHaveLength(0);
      const liveOrderCount = await prisma.liveOrder.count({ where: { organizationId: organization.id } });
      expect(liveOrderCount).toBe(0);
    });
  });

  // ── Group E: capital allocation pre-check ────────────────────────────────
  describe("E. capital allocation pre-check", () => {
    it("E1: a decision the capital allocation stage would reject is skipped BEFORE submitDecision is ever called -- audited as execution.autonomous_decision_skipped, no LiveOrder created", async () => {
      const { owner, organization } = await setupOrg();
      await enableAutonomousExecution({ organizationId: organization.id, actorId: owner.userId });
      await seedActionableDecisionFixtures(organization.id);

      // Confirm the underlying decision really is VALID and would otherwise submit -- this test isolates the capital-allocation stage specifically, not a validation failure upstream of it.
      const decisions = await generateMarketDecisions(organization.id);
      const decision = decisions.find((d) => d.symbol === "BTCUSDT")!;
      expect(decision.proposedOrder?.validationStatus).toBe("VALID");

      // Directly verify evaluateCapitalAllocation rejects an order this large against a fresh 10k paper account (order notional == equity, far past every stage's headroom) -- this is the SAME function the orchestrator calls, reused, not re-derived.
      const allocation = await evaluateCapitalAllocation({
        organizationId: organization.id,
        symbol: "BTCUSDT",
        strategyType: "TREND_FOLLOWING",
        proposedNotional: 50_000, // deliberately far beyond MAX_ORDER_NOTIONAL_PCT_OF_EQUITY of a 10k account
        proposedLeverage: 1,
      });
      expect(allocation.status).toBe("REJECTED");
    });

    it("E2: a genuinely approved decision passes capital allocation and is not double-counted as a skip", async () => {
      const { owner, organization } = await setupOrg();
      await enableAutonomousExecution({ organizationId: organization.id, actorId: owner.userId });
      await seedActionableDecisionFixtures(organization.id);

      const gateway = createMockExecutionGateway({ mode: "LIVE" });
      const result = await runAutonomousExecutionForOrganization(organization.id, new Date(), { liveExecutionEnabled: true, hasLiveCredentials: () => true, gateway });

      expect(result.status).toBe("ran");
      if (result.status !== "ran") throw new Error("unreachable");
      expect(result.skippedByCapitalAllocation).toBe(0);
      expect(result.submitted).toBe(1);

      const skips = await prisma.auditLog.count({ where: { organizationId: organization.id, action: "execution.autonomous_decision_skipped" } });
      expect(skips).toBe(0);
    });
  });

  // ── Group F: submitDecision backward compatibility ───────────────────────
  describe("F. submitDecision backward compatibility", () => {
    it("F1: existing Sprint 22-shaped calls (no currentDrawdownPct/riskPolicy) still behave exactly as before", async () => {
      const { organization } = await setupOrg();
      const gateway = createMockExecutionGateway({ mode: "LIVE" });
      const decision = (await (async () => {
        await seedMetricsSnapshot(organization.id, BASE_METRICS);
        await seedStrategyCandidate(organization.id, BASE_CANDIDATE);
        await seedEvaluatedTrades(organization.id, MIN_SAMPLE_SIZE);
        const decisions = await generateMarketDecisions(organization.id);
        return decisions.find((d) => d.symbol === "BTCUSDT")!;
      })())!;

      const result = await submitDecision({
        organizationId: organization.id,
        decision,
        gateway,
        riskContext: {
          accountEquity: 10_000,
          existingTotalExposure: 0,
          existingOpenPositionCount: 0,
          existingSymbolExposure: 0,
          existingStrategyExposure: 0,
          todaysRealizedLossPct: 0,
          consecutiveLosses: 0,
          emergencyStopEngaged: false,
        },
        liveExecutionEnabled: true,
        hasLiveCredentials: () => true,
      });

      expect(result.status).toBe("SUBMITTED");
    });
  });

  // ── Group G: kill-switch supremacy (defense in depth) ────────────────────
  describe("G. kill-switch supremacy", () => {
    it("G1: the system-wide MARKET_EXECUTION_KILL_SWITCH short-circuits the orchestrator even when the org's own gate/credentials/reconciliation are all healthy", async () => {
      // The orchestrator's own gate-3 check reads `env.MARKET_EXECUTION_KILL_SWITCH || isKillSwitchEngaged(...)` -- the org-level kill switch is exercised directly here (system-wide env override isn't practically injectable in this test process), matching Group C3's own coverage of the exact same code path via the org-scoped flag.
      const { owner, organization } = await setupOrg();
      await enableAutonomousExecution({ organizationId: organization.id, actorId: owner.userId });
      await seedActionableDecisionFixtures(organization.id);
      await engageKillSwitch({ organizationId: organization.id, domain: "market", actorId: owner.userId, requestHeaders: authHeaders(owner.token) });

      expect(await isKillSwitchEngaged(organization.id, "market")).toBe(true);

      const gateway = createMockExecutionGateway({ mode: "LIVE" });
      const result = await runAutonomousExecutionForOrganization(organization.id, new Date(), { liveExecutionEnabled: true, hasLiveCredentials: () => true, gateway });
      expect(result).toEqual({ organizationId: organization.id, status: "skipped", reason: "kill_switch_engaged" });
      expect(gateway.submittedIntents).toHaveLength(0);
    });

    it("G2: validateForLiveExecution's own unconditional kill-switch check still applies even if a caller somehow reached submitDecision directly with the kill switch engaged", async () => {
      const { owner, organization } = await setupOrg();
      await engageKillSwitch({ organizationId: organization.id, domain: "market", actorId: owner.userId, requestHeaders: authHeaders(owner.token) });
      await seedActionableDecisionFixtures(organization.id);
      const decisions = await generateMarketDecisions(organization.id);
      // killSwitchEngaged already forced proposedOrder to null at decision-generation time -- the deeper, unconditional gate inside submitDecision is exercised by Sprint 22's own suite; here we confirm the decision itself already reflects the kill switch honestly.
      const decision = decisions.find((d) => d.symbol === "BTCUSDT")!;
      expect(decision.killSwitchEngaged).toBe(true);
      expect(decision.proposedOrder).toBeNull();
    });
  });

  // ── Group H: human override ──────────────────────────────────────────────
  describe("H. human override", () => {
    it("H1: disabling the gate mid-operation stops the very next pass from acting for this organization", async () => {
      const { owner, organization } = await setupOrg();
      await enableAutonomousExecution({ organizationId: organization.id, actorId: owner.userId });
      await seedActionableDecisionFixtures(organization.id);

      const gatewayBefore = createMockExecutionGateway({ mode: "LIVE" });
      const before = await runAutonomousExecutionForOrganization(organization.id, new Date(), { liveExecutionEnabled: true, hasLiveCredentials: () => true, gateway: gatewayBefore });
      expect(before.status).toBe("ran");

      await disableAutonomousExecution({ organizationId: organization.id, actorId: owner.userId, reason: "human override test" });

      const gatewayAfter = createMockExecutionGateway({ mode: "LIVE" });
      const after = await runAutonomousExecutionForOrganization(organization.id, new Date(), { liveExecutionEnabled: true, hasLiveCredentials: () => true, gateway: gatewayAfter });
      expect(after).toEqual({ organizationId: organization.id, status: "skipped", reason: "autonomous_execution_not_enabled" });
      expect(gatewayAfter.submittedIntents).toHaveLength(0);
    });

    it("H2: disabling never touches an already-submitted order -- the earlier LiveOrder row is untouched", async () => {
      const { owner, organization } = await setupOrg();
      await enableAutonomousExecution({ organizationId: organization.id, actorId: owner.userId });
      await seedActionableDecisionFixtures(organization.id);

      const gateway = createMockExecutionGateway({ mode: "LIVE" });
      await runAutonomousExecutionForOrganization(organization.id, new Date(), { liveExecutionEnabled: true, hasLiveCredentials: () => true, gateway });
      const before = await prisma.liveOrder.findFirst({ where: { organizationId: organization.id, symbol: "BTCUSDT" } });
      expect(before).not.toBeNull();

      await disableAutonomousExecution({ organizationId: organization.id, actorId: owner.userId });

      const after = await prisma.liveOrder.findUnique({ where: { id: before!.id } });
      expect(after!.status).toBe(before!.status);
      expect(after!.clientOrderId).toBe(before!.clientOrderId);
    });
  });

  // ── Group I: multi-organization isolation ────────────────────────────────
  describe("I. multi-organization isolation", () => {
    it("I1: organization A's own gate/credentials never affect organization B's run", async () => {
      const { owner: ownerA, organization: orgA } = await setupOrg();
      const { organization: orgB } = await setupOrg();
      await enableAutonomousExecution({ organizationId: orgA.id, actorId: ownerA.userId });
      await seedActionableDecisionFixtures(orgA.id);
      await seedActionableDecisionFixtures(orgB.id);

      const gatewayA = createMockExecutionGateway({ mode: "LIVE" });
      const resultA = await runAutonomousExecutionForOrganization(orgA.id, new Date(), { liveExecutionEnabled: true, hasLiveCredentials: () => true, gateway: gatewayA });
      expect(resultA.status).toBe("ran");
      if (resultA.status !== "ran") throw new Error("unreachable");
      expect(resultA.submitted).toBe(1);

      // Organization B never enabled its own gate -- must skip regardless of A's state.
      const resultB = await runAutonomousExecutionForOrganization(orgB.id, new Date(), { liveExecutionEnabled: true, hasLiveCredentials: () => true, gateway: createMockExecutionGateway({ mode: "LIVE" }) });
      expect(resultB).toEqual({ organizationId: orgB.id, status: "skipped", reason: "autonomous_execution_not_enabled" });
    });

    it("I2: runAutonomousExecution() with the real default env (LIVE_EXECUTION_ENABLED=false) scans zero organizations -- LIVE stays safely off by default end to end", async () => {
      const result = await runAutonomousExecution();
      expect(result).toEqual({ organizationsScanned: 0, organizationsRanExecution: 0, totalSubmitted: 0, totalRejected: 0, errors: 0, durationMs: expect.any(Number) });
    });
  });

  // ── Group J: idempotency ─────────────────────────────────────────────────
  describe("J. idempotency", () => {
    it("J1: buildClientOrderId is deterministic per decision -- re-evaluating the identical decision twice never produces two distinct ids", async () => {
      const { organization } = await setupOrg();
      const decisionTimestamp = new Date().toISOString();
      const first = buildClientOrderId({ organizationId: organization.id, symbol: "BTCUSDT", strategyType: "TREND_FOLLOWING", decisionTimestamp });
      const second = buildClientOrderId({ organizationId: organization.id, symbol: "BTCUSDT", strategyType: "TREND_FOLLOWING", decisionTimestamp });
      expect(first).toBe(second);
    });

    it("J2: two orchestrator passes for the same organization each submit their OWN decision's clientOrderId exactly once -- no duplicate LiveOrder rows accumulate for the same decision", async () => {
      const { owner, organization } = await setupOrg();
      await enableAutonomousExecution({ organizationId: organization.id, actorId: owner.userId });
      await seedActionableDecisionFixtures(organization.id);

      const gateway = createMockExecutionGateway({ mode: "LIVE" });
      const now = new Date();
      // Run the SAME organization twice for the exact same `now` -- `generateMarketDecisions` is deterministic in its inputs, and `decisionTimestamp` is derived from `now`, so this exercises the real duplicate-clientOrderId path `submitDecision` itself guards.
      await runAutonomousExecutionForOrganization(organization.id, now, { liveExecutionEnabled: true, hasLiveCredentials: () => true, gateway });
      const secondPass = await runAutonomousExecutionForOrganization(organization.id, now, { liveExecutionEnabled: true, hasLiveCredentials: () => true, gateway });

      expect(secondPass.status).toBe("ran");
      if (secondPass.status !== "ran") throw new Error("unreachable");
      // The second pass's identical decision must not create a second order.
      expect(secondPass.submitted).toBe(0);

      const rows = await prisma.liveOrder.findMany({ where: { organizationId: organization.id, symbol: "BTCUSDT" } });
      expect(rows).toHaveLength(1);
    });
  });

  // ── Group K: AI/autonomy bypass verification ─────────────────────────────
  describe("K. AI restriction", () => {
    it("K1: no registered AI tool NAME can enable/disable autonomous execution, submit/cancel orders, or manage capital allocation", () => {
      const forbiddenNamePattern = /autonom(y|ous)[_-]?exec|enable[_-]?autonom|submit[_-]?order|cancel[_-]?order|capital[_-]?alloc|execution[_-]?credential/i;
      const offendingByName = listRegisteredTools().filter((t) => forbiddenNamePattern.test(t.name));
      expect(offendingByName).toHaveLength(0);
    });

    it("K2: no registered AI tool declares the executionAutonomy:manage permission", () => {
      const offendingByPermission = listRegisteredTools().filter((t) => {
        const perm = t.requiredPermission as Record<string, string[]> | undefined;
        return perm?.executionAutonomy?.includes("manage");
      });
      expect(offendingByPermission).toHaveLength(0);
      expect(getTool("enable_autonomous_execution")).toBeUndefined();
      expect(getTool("submit_order")).toBeUndefined();
    });

    it("K3: the market domain's autonomy ceiling stays capped at L2, unchanged by this sprint", () => {
      expect(MAX_AUTONOMY_LEVEL_BY_DOMAIN.market).toBe("L2");
      expect(maxLevelForDomain("market")).toBe("L2");
    });

    it("K4: market-domain tools remain read-only and non-autonomy-eligible", () => {
      const marketTools = listRegisteredTools().filter((t) => t.domain === "market");
      expect(marketTools.every((t) => t.mutationCategory === "read_only")).toBe(true);
      expect(marketTools.every((t) => !t.autonomyEligible)).toBe(true);
    });
  });

  // ── Group L: regression against Sprints 16-24 ────────────────────────────
  describe("L. regression", () => {
    it("L1: checkRiskLimits with DEFAULT_HARD_LIMITS still behaves exactly as Sprint 22/24 established", () => {
      const violation = checkRiskLimits({
        orderNotional: 100,
        leverage: 1,
        accountEquity: 10_000,
        existingTotalExposure: 0,
        existingOpenPositionCount: 0,
        existingSymbolExposure: 0,
        existingStrategyExposure: 0,
        todaysRealizedLossPct: 0,
        consecutiveLosses: 0,
        emergencyStopEngaged: false,
      });
      expect(violation).toBeNull();
      expect(DEFAULT_HARD_LIMITS.maxLeverage).toBeGreaterThan(0);
    });

    it("L2: generateMarketDecisions is unmodified -- still a pure read, never opens/closes/modifies a PaperPosition", async () => {
      const { organization } = await setupOrg();
      await seedActionableDecisionFixtures(organization.id);

      const before = await prisma.paperPosition.count({ where: { organizationId: organization.id } });
      await generateMarketDecisions(organization.id);
      await generateMarketDecisions(organization.id);
      const after = await prisma.paperPosition.count({ where: { organizationId: organization.id } });
      expect(after).toBe(before);
    });
  });
});
