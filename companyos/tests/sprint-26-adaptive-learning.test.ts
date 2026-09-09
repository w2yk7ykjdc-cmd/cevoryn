import { afterAll, describe, expect, it } from "vitest";
import "@/server/ai/tools/builtin";
import { prisma } from "@/server/db/client";
import { getTenantScopedClient, CrossTenantAccessError } from "@/server/db/tenant";
import { getTool, listRegisteredTools } from "@/server/ai/tools/registry";
import { runPaperTradeResult } from "@/server/intelligence/outcome/rules/paper-trade-result";
import { MIN_SAMPLE_SIZE } from "@/server/intelligence/decision-intelligence/sample-safety";
import { getStrategyEvaluations } from "@/server/intelligence/strategy-evaluation/service";
import { generateMarketDecisions } from "@/server/intelligence/market-decision/service";
import {
  computeStrategyHealthTransition,
  evaluateStrategyHealth,
  getBlockedStrategyTypes,
  listStrategyHealth,
  reactivateStrategy,
  QUARANTINE_SCORE_THRESHOLD,
  StrategyHealthNotFoundError,
  StrategyHealthNotReactivatableError,
} from "@/server/intelligence/learning/strategy-health";
import { evaluateStrategyHealthForAllOrganizations } from "@/server/intelligence/learning/evaluate-strategy-health";
import { recordSignal } from "@/server/intelligence/signals/service";
import { METRICS_SNAPSHOT_RULE_NAME, METRICS_SNAPSHOT_RULE_VERSION, type MarketMetricsSnapshotPayload } from "@/server/intelligence/signals/market-scanner";
import { STRATEGY_CANDIDATE_RULE_NAME, STRATEGY_CANDIDATE_RULE_VERSION } from "@/server/intelligence/strategy/generate";
import type { StrategyCandidate } from "@/server/intelligence/strategy/types";
import { closeTestConnections, createClosedPaperTrade, createOrgForUser, signUpUser } from "./helpers";

afterAll(closeTestConnections);

/**
 * Sprint 26 test suite -- adaptive learning: strategy degradation
 * detection, confidence-calibration-informed evaluationScore (reused
 * verbatim from Sprint 18), quarantine/retirement, controlled discovery
 * (TRIAL), and the gate's wiring into the decision/entry layer. Every
 * input is real, persisted `PaperTrade`/`Outcome` data -- never a second,
 * parallel scoring formula.
 */

const STRATEGY_TYPE = "TREND_FOLLOWING";
const SYMBOL = "BTCUSDT";

async function setupOrg() {
  const owner = await signUpUser();
  const organization = await createOrgForUser(owner);
  return { owner, organization };
}

/** Seeds `count` closed, evaluated trades with a fixed `returnPct`, evenly spread across time so temporal-bucket splitting is deterministic. */
async function seedTrades(organizationId: string, count: number, returnPct: number, startOffsetMs: number, strategyType = STRATEGY_TYPE): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await createClosedPaperTrade(organizationId, {
      strategyType,
      symbol: SYMBOL,
      returnPct,
      closedAt: new Date(Date.now() - startOffsetMs + i * 1000),
    });
  }
}

/**
 * The exact fixture that reliably trips ACTIVE -> QUARANTINED: 8 winning
 * trades (chronologically oldest), 16 losing trades (chronologically
 * newest) for the SAME symbol/strategy -- older-bucket win rate 100%,
 * recent-bucket win rate 0% (a >=15pt decline), overall evidenceQuality
 * "moderate" (24 evaluated trades), and a low evaluationScore (single-
 * symbol concentration zeroes the symbol-robustness component, and the
 * 800/400 peak-to-trough drawdown maxes the drawdown penalty).
 */
async function seedDegradingStrategy(organizationId: string, strategyType = STRATEGY_TYPE): Promise<void> {
  await seedTrades(organizationId, 8, 0.05, 24 * 60 * 60 * 1000, strategyType); // older: wins
  await seedTrades(organizationId, 16, -0.05, 12 * 60 * 60 * 1000, strategyType); // previous+recent: losses
  await runPaperTradeResult(organizationId);
}

describe("Sprint 26: Adaptive Learning", () => {
  // ── Group A: controlled discovery (TRIAL) ────────────────────────────────
  describe("A. controlled discovery", () => {
    it("A1: a strategy type with no trades yet has no health row and is never blocked", async () => {
      const { organization } = await setupOrg();
      expect(await getBlockedStrategyTypes(organization.id)).toEqual(new Set());
      expect(await listStrategyHealth(organization.id)).toEqual([]);
    });

    it("A2: fewer than MIN_SAMPLE_SIZE evaluated trades lazily creates a TRIAL row, still fully tradable", async () => {
      const { organization } = await setupOrg();
      await seedTrades(organization.id, MIN_SAMPLE_SIZE - 1, 0.05, 60_000);
      await runPaperTradeResult(organization.id);

      const result = await evaluateStrategyHealth(organization.id);
      expect(result.transitioned).toBe(0);

      const rows = await listStrategyHealth(organization.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe("TRIAL");
      expect(await getBlockedStrategyTypes(organization.id)).toEqual(new Set());
    });

    it("A3: reaching MIN_SAMPLE_SIZE evaluated trades graduates TRIAL -> ACTIVE automatically", async () => {
      const { organization } = await setupOrg();
      await seedTrades(organization.id, MIN_SAMPLE_SIZE, 0.05, 60_000);
      await runPaperTradeResult(organization.id);

      const result = await evaluateStrategyHealth(organization.id);
      expect(result.transitioned).toBe(1);

      const rows = await listStrategyHealth(organization.id);
      expect(rows[0]!.status).toBe("ACTIVE");
    });
  });

  // ── Group B: degradation detection + quarantine ──────────────────────────
  describe("B. degradation detection and quarantine", () => {
    it("B1: a genuine recent decline with sufficient overall evidence quarantines an ACTIVE strategy automatically", async () => {
      const { organization } = await setupOrg();
      // First pass: graduate to ACTIVE with a small clean sample.
      await seedTrades(organization.id, MIN_SAMPLE_SIZE, 0.05, 30 * 24 * 60 * 60 * 1000);
      await runPaperTradeResult(organization.id);
      await evaluateStrategyHealth(organization.id);
      expect((await listStrategyHealth(organization.id))[0]!.status).toBe("ACTIVE");

      // Now add the degrading pattern on top.
      await seedDegradingStrategy(organization.id);
      const evaluation = (await getStrategyEvaluations(organization.id)).find((e) => e.strategyType === STRATEGY_TYPE)!;
      expect(evaluation.status).toBe("evaluated");
      if (evaluation.status !== "evaluated") throw new Error("unreachable");
      expect(evaluation.evidenceQuality === "moderate" || evaluation.evidenceQuality === "strong").toBe(true);
      expect(evaluation.evaluationScore).toBeLessThan(QUARANTINE_SCORE_THRESHOLD);

      const result = await evaluateStrategyHealth(organization.id);
      expect(result.transitioned).toBe(1);

      const row = (await listStrategyHealth(organization.id))[0]!;
      expect(row.status).toBe("QUARANTINED");
      expect(row.quarantinedAt).not.toBeNull();
      expect(row.reason).toContain("quarantine threshold");
    });

    it("B2: quarantine is audited via the existing AuditLog (no new audit table)", async () => {
      const { organization } = await setupOrg();
      await seedDegradingStrategy(organization.id);
      await evaluateStrategyHealth(organization.id);

      const rows = await prisma.auditLog.findMany({ where: { organizationId: organization.id, action: "learning.strategy_quarantined" } });
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0]!.actorType).toBe("system");
      expect(rows[0]!.targetId).toBe(STRATEGY_TYPE);
    });

    it("B3: a stable strategy (win/loss interleaved evenly across time, no temporal decline) is never quarantined", async () => {
      const { organization } = await setupOrg();
      // 24 trades, wins and losses INTERLEAVED chronologically -- the
      // older/previous/recent temporal buckets all see roughly the same
      // ~50% win rate, so no >=15pt decline is ever detected, regardless
      // of the overall evaluationScore.
      for (let i = 0; i < 24; i += 1) {
        await createClosedPaperTrade(organization.id, {
          strategyType: STRATEGY_TYPE,
          symbol: SYMBOL,
          returnPct: i % 2 === 0 ? 0.05 : -0.03,
          closedAt: new Date(Date.now() - (24 - i) * 60 * 60 * 1000),
        });
      }
      await runPaperTradeResult(organization.id);

      await evaluateStrategyHealth(organization.id);
      const row = (await listStrategyHealth(organization.id))[0]!;
      expect(row.status).not.toBe("QUARANTINED");
    });
  });

  // ── Group C: retirement ───────────────────────────────────────────────────
  describe("C. retirement", () => {
    it("C1: a QUARANTINED strategy that stays degraded after a fresh MIN_SAMPLE_SIZE of new evidence is RETIRED", async () => {
      const { organization } = await setupOrg();
      await seedDegradingStrategy(organization.id);
      await evaluateStrategyHealth(organization.id);
      expect((await listStrategyHealth(organization.id))[0]!.status).toBe("QUARANTINED");

      // Fresh, still-bad evidence since quarantine.
      await seedTrades(organization.id, MIN_SAMPLE_SIZE, -0.05, 20_000);
      await runPaperTradeResult(organization.id);

      const result = await evaluateStrategyHealth(organization.id);
      expect(result.transitioned).toBe(1);
      const row = (await listStrategyHealth(organization.id))[0]!;
      expect(row.status).toBe("RETIRED");
      expect(row.retiredAt).not.toBeNull();
    });

    it("C2: a QUARANTINED strategy with fewer than MIN_SAMPLE_SIZE new evaluated trades since quarantine is never retired yet", async () => {
      const { organization } = await setupOrg();
      await seedDegradingStrategy(organization.id);
      await evaluateStrategyHealth(organization.id);

      await seedTrades(organization.id, MIN_SAMPLE_SIZE - 1, -0.05, 20_000);
      await runPaperTradeResult(organization.id);

      const result = await evaluateStrategyHealth(organization.id);
      expect(result.transitioned).toBe(0);
      expect((await listStrategyHealth(organization.id))[0]!.status).toBe("QUARANTINED");
    });

    it("C3: RETIRED is terminal -- automatic evaluation never transitions it further", async () => {
      const { organization } = await setupOrg();
      await seedDegradingStrategy(organization.id);
      await evaluateStrategyHealth(organization.id);
      await seedTrades(organization.id, MIN_SAMPLE_SIZE, -0.05, 20_000);
      await runPaperTradeResult(organization.id);
      await evaluateStrategyHealth(organization.id);
      expect((await listStrategyHealth(organization.id))[0]!.status).toBe("RETIRED");

      await seedTrades(organization.id, MIN_SAMPLE_SIZE, 0.05, 20_000);
      await runPaperTradeResult(organization.id);
      const result = await evaluateStrategyHealth(organization.id);
      expect(result.transitioned).toBe(0);
      expect((await listStrategyHealth(organization.id))[0]!.status).toBe("RETIRED");
    });
  });

  // ── Group D: human-only reactivation ──────────────────────────────────────
  describe("D. human-only reactivation", () => {
    it("D1: reactivateStrategy brings a QUARANTINED strategy back to ACTIVE and is audited", async () => {
      const { owner, organization } = await setupOrg();
      await seedDegradingStrategy(organization.id);
      await evaluateStrategyHealth(organization.id);
      expect((await listStrategyHealth(organization.id))[0]!.status).toBe("QUARANTINED");

      const reactivated = await reactivateStrategy({ organizationId: organization.id, strategyType: STRATEGY_TYPE, actorId: owner.userId });
      expect(reactivated.status).toBe("ACTIVE");
      expect(reactivated.reactivatedById).toBe(owner.userId);
      expect(await getBlockedStrategyTypes(organization.id)).toEqual(new Set());

      const auditRows = await prisma.auditLog.findMany({ where: { organizationId: organization.id, action: "learning.strategy_reactivated" } });
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]!.actorType).toBe("user");
      expect(auditRows[0]!.actorId).toBe(owner.userId);
    });

    it("D2: reactivateStrategy also works on a RETIRED strategy", async () => {
      const { owner, organization } = await setupOrg();
      await seedDegradingStrategy(organization.id);
      await evaluateStrategyHealth(organization.id);
      await seedTrades(organization.id, MIN_SAMPLE_SIZE, -0.05, 20_000);
      await runPaperTradeResult(organization.id);
      await evaluateStrategyHealth(organization.id);
      expect((await listStrategyHealth(organization.id))[0]!.status).toBe("RETIRED");

      const reactivated = await reactivateStrategy({ organizationId: organization.id, strategyType: STRATEGY_TYPE, actorId: owner.userId });
      expect(reactivated.status).toBe("ACTIVE");
    });

    it("D3: reactivateStrategy throws for a strategy type with no health row", async () => {
      const { owner, organization } = await setupOrg();
      await expect(reactivateStrategy({ organizationId: organization.id, strategyType: "NONEXISTENT", actorId: owner.userId })).rejects.toBeInstanceOf(StrategyHealthNotFoundError);
    });

    it("D4: reactivateStrategy throws for an ACTIVE strategy (nothing to reactivate)", async () => {
      const { owner, organization } = await setupOrg();
      await seedTrades(organization.id, MIN_SAMPLE_SIZE, 0.05, 60_000);
      await runPaperTradeResult(organization.id);
      await evaluateStrategyHealth(organization.id);
      expect((await listStrategyHealth(organization.id))[0]!.status).toBe("ACTIVE");

      await expect(reactivateStrategy({ organizationId: organization.id, strategyType: STRATEGY_TYPE, actorId: owner.userId })).rejects.toBeInstanceOf(StrategyHealthNotReactivatableError);
    });

    it("D5: reactivation is NEVER automatic -- evaluateStrategyHealth alone can only move QUARANTINED forward to RETIRED, never back to ACTIVE, regardless of new evidence", async () => {
      const { organization } = await setupOrg();
      await seedDegradingStrategy(organization.id);
      await evaluateStrategyHealth(organization.id);
      expect((await listStrategyHealth(organization.id))[0]!.status).toBe("QUARANTINED");

      // Add fresh evidence and re-evaluate as many times as the automatic
      // job would -- the ONLY two reachable states from here without a
      // human calling reactivateStrategy are QUARANTINED (still waiting /
      // recovered-but-not-reactivated) or RETIRED (still bad). ACTIVE is
      // never reachable automatically.
      for (let i = 0; i < 3; i += 1) {
        await seedTrades(organization.id, MIN_SAMPLE_SIZE, 0.1, 20_000 + i * 100_000);
        await runPaperTradeResult(organization.id);
        await evaluateStrategyHealth(organization.id);
        const status = (await listStrategyHealth(organization.id))[0]!.status;
        expect(status === "QUARANTINED" || status === "RETIRED").toBe(true);
      }
    });
  });

  // ── Group E: gate wiring -- decision engine ──────────────────────────────
  describe("E. decision-engine gate wiring", () => {
    async function seedActionableCandidate(organizationId: string): Promise<void> {
      const metrics: MarketMetricsSnapshotPayload = {
        symbol: SYMBOL,
        dailyPercentChange: 5,
        shortTermPercentChange: 1,
        mediumPercentChange: 3,
        trendConsistency: 0.8,
        volumeRatio: 2,
        volatilityPct: 1,
        relativeStrength: 2,
        observedAt: new Date().toISOString(),
        lastClose: 50000,
      };
      const candidate: StrategyCandidate = {
        symbol: SYMBOL,
        strategyType: STRATEGY_TYPE,
        strategyVersion: "v1",
        direction: "up",
        score: 80,
        confidence: 90,
        marketRegime: "trending",
        supportingSignals: ["s"],
        contradictingSignals: [],
        thesis: "t",
        entryConditions: ["e"],
        invalidationConditions: ["i"],
        riskConditions: [],
        expectedScenario: "Hypothetical: riskUnit = 1 x",
        noTradeReason: null,
        riskUnit: 1,
        sourceOpportunityId: null,
        sourceRiskId: null,
        observedAt: metrics.observedAt,
      };
      await recordSignal({ organizationId, type: METRICS_SNAPSHOT_RULE_NAME, sourceType: "scanner", sourceId: `${SYMBOL}:1h`, severity: "low", confidence: 90, ruleName: METRICS_SNAPSHOT_RULE_NAME, ruleVersion: METRICS_SNAPSHOT_RULE_VERSION, relatedEntityType: "MarketSymbol", relatedEntityId: SYMBOL, payload: metrics });
      await recordSignal({ organizationId, type: STRATEGY_CANDIDATE_RULE_NAME, sourceType: "scanner", sourceId: `${SYMBOL}:1h`, severity: "medium", confidence: 90, ruleName: STRATEGY_CANDIDATE_RULE_NAME, ruleVersion: STRATEGY_CANDIDATE_RULE_VERSION, relatedEntityType: "MarketSymbol", relatedEntityId: SYMBOL, payload: candidate });
    }

    it("E1: a QUARANTINED strategy type never gets a proposedOrder from generateMarketDecisions, even with a real directional candidate", async () => {
      const { organization } = await setupOrg();
      await seedDegradingStrategy(organization.id);
      await evaluateStrategyHealth(organization.id);
      expect((await listStrategyHealth(organization.id))[0]!.status).toBe("QUARANTINED");

      await seedActionableCandidate(organization.id);
      const decisions = await generateMarketDecisions(organization.id);
      const decision = decisions.find((d) => d.symbol === SYMBOL)!;
      expect(decision.strategyQuarantined).toBe(true);
      expect(decision.proposedOrder).toBeNull();
      expect(decision.reasons.some((r) => r.includes("QUARANTINED"))).toBe(true);
    });

    it("E2: an ACTIVE (non-quarantined) strategy type is completely unaffected -- strategyQuarantined is false", async () => {
      const { organization } = await setupOrg();
      await seedActionableCandidate(organization.id);
      const decisions = await generateMarketDecisions(organization.id);
      const decision = decisions.find((d) => d.symbol === SYMBOL)!;
      expect(decision.strategyQuarantined).toBe(false);
    });

    it("E3: quarantine only blocks the affected strategy type -- a different strategy type on a different symbol is unaffected", async () => {
      const { organization } = await setupOrg();
      await seedDegradingStrategy(organization.id, STRATEGY_TYPE);
      await evaluateStrategyHealth(organization.id);
      expect(await getBlockedStrategyTypes(organization.id)).toEqual(new Set([STRATEGY_TYPE]));

      // A second, healthy strategy type / symbol is untouched.
      await seedTrades(organization.id, MIN_SAMPLE_SIZE, 0.05, 60_000, "MOMENTUM_CONTINUATION");
      await runPaperTradeResult(organization.id);
      await evaluateStrategyHealth(organization.id);
      expect(await getBlockedStrategyTypes(organization.id)).toEqual(new Set([STRATEGY_TYPE]));
    });
  });

  // ── Group F: scheduled job ────────────────────────────────────────────────
  describe("F. scheduled job", () => {
    it("F1: evaluateStrategyHealthForAllOrganizations processes multiple organizations, one bad org never blocking another's", async () => {
      const { organization: orgA } = await setupOrg();
      const { organization: orgB } = await setupOrg();
      await seedDegradingStrategy(orgA.id);
      await seedTrades(orgB.id, MIN_SAMPLE_SIZE, 0.05, 60_000);
      await runPaperTradeResult(orgB.id);

      const result = await evaluateStrategyHealthForAllOrganizations();
      expect(result.errors).toBe(0);
      expect(result.organizationsScanned).toBeGreaterThanOrEqual(2);

      expect((await listStrategyHealth(orgA.id))[0]!.status).toBe("QUARANTINED");
      expect((await listStrategyHealth(orgB.id))[0]!.status).toBe("ACTIVE");
    });
  });

  // ── Group G: tenant isolation ─────────────────────────────────────────────
  describe("G. tenant isolation", () => {
    it("G1: organization B cannot read organization A's strategy health state through the tenant-scoped client", async () => {
      const { organization: orgA } = await setupOrg();
      const { organization: orgB } = await setupOrg();
      await seedDegradingStrategy(orgA.id);
      await evaluateStrategyHealth(orgA.id);

      const scopedB = getTenantScopedClient(orgB.id);
      await expect(scopedB.strategyHealthState.findFirst({ where: { organizationId: orgA.id } })).rejects.toThrow(CrossTenantAccessError);
      expect(await listStrategyHealth(orgB.id)).toEqual([]);
    });

    it("G2: quarantining organization A's strategy never blocks organization B's identical strategy type", async () => {
      const { organization: orgA } = await setupOrg();
      const { organization: orgB } = await setupOrg();
      await seedDegradingStrategy(orgA.id);
      await evaluateStrategyHealth(orgA.id);

      expect(await getBlockedStrategyTypes(orgA.id)).toEqual(new Set([STRATEGY_TYPE]));
      expect(await getBlockedStrategyTypes(orgB.id)).toEqual(new Set());
    });

    it("G3: reactivateStrategy cannot be used cross-tenant -- acting on orgB's id never finds orgA's row", async () => {
      const { owner: ownerB, organization: orgA } = await setupOrg();
      const { organization: orgB } = await setupOrg();
      await seedDegradingStrategy(orgA.id);
      await evaluateStrategyHealth(orgA.id);

      await expect(reactivateStrategy({ organizationId: orgB.id, strategyType: STRATEGY_TYPE, actorId: ownerB.userId })).rejects.toBeInstanceOf(StrategyHealthNotFoundError);
    });
  });

  // ── Group H: AI restriction ────────────────────────────────────────────────
  describe("H. AI restriction", () => {
    it("H1: no registered AI tool NAME can quarantine, retire, or reactivate a strategy", () => {
      const forbiddenNamePattern = /quarantine|retire|reactivate[_-]?strategy|set[_-]?strategy[_-]?health/i;
      const offending = listRegisteredTools().filter((t) => forbiddenNamePattern.test(t.name));
      expect(offending).toHaveLength(0);
      expect(getTool("reactivate_strategy")).toBeUndefined();
      expect(getTool("quarantine_strategy")).toBeUndefined();
    });

    it("H2: no registered AI tool declares the strategyHealth:manage permission", () => {
      const offendingByPermission = listRegisteredTools().filter((t) => {
        const perm = t.requiredPermission as Record<string, string[]> | undefined;
        return perm?.strategyHealth?.includes("manage");
      });
      expect(offendingByPermission).toHaveLength(0);
    });

    it("H3: get_strategy_performance surfaces strategyHealth read-only, alongside the unmodified Sprint 18 evaluations", async () => {
      const { organization } = await setupOrg();
      await seedDegradingStrategy(organization.id);
      await evaluateStrategyHealth(organization.id);

      const tool = getTool("get_strategy_performance")!;
      const result = (await tool.handler({}, { organizationId: organization.id } as never)) as { strategyHealth: Array<{ strategyType: string; status: string }>; evaluations: unknown[] };
      expect(result.strategyHealth.some((h) => h.strategyType === STRATEGY_TYPE && h.status === "QUARANTINED")).toBe(true);
      expect(result.evaluations.length).toBeGreaterThan(0);
    });
  });

  // ── Group I: pure verdict function (unit, no I/O) ────────────────────────
  describe("I. computeStrategyHealthTransition", () => {
    const insufficient = { status: "insufficient_evidence" as const, strategyType: STRATEGY_TYPE, evaluatedTrades: 2, minimumRequired: MIN_SAMPLE_SIZE };

    it("I1: insufficient evidence always yields 'none', regardless of current status", () => {
      expect(computeStrategyHealthTransition(insufficient, "TRIAL", null).action).toBe("none");
      expect(computeStrategyHealthTransition(insufficient, "ACTIVE", null).action).toBe("none");
      expect(computeStrategyHealthTransition(insufficient, "QUARANTINED", 10).action).toBe("none");
    });

    it("I2: RETIRED never transitions automatically, even with a genuinely evaluated verdict", () => {
      const evaluated = { status: "evaluated" as const, strategyType: STRATEGY_TYPE, evidenceQuality: "strong" as const, sampleSize: 50, evaluatedTrades: 50, winRate: 90, averageReturnPct: 5, totalRealizedPnl: 500, averagePnl: 10, bestTradePnl: 100, worstTradePnl: -10, maxDrawdown: { status: "no_data" as const }, liquidationRate: 0, stopRate: 0, takeProfitRate: 100, invalidationRate: 0, averageHoldingDurationMs: 1000, feeImpact: 0, fundingImpact: 0, riskAdjustedReturn: { status: "insufficient_evidence" as const }, confidenceCalibration: [], regimeRobustness: [], symbolRobustness: { uniqueSymbols: 1, profitableSymbols: 1, losingSymbols: 0, breakEvenSymbols: 0, bestSymbol: null, worstSymbol: null, concentrationIndex: null }, directionRobustness: [], leverageRobustness: [], temporalRobustness: { status: "insufficient_evidence" as const }, failureAnalysis: { totalFailingTrades: 0, byReason: [] }, evaluationScore: 95, scoreBreakdown: { performanceComponent: 40, consistencyComponent: 0, regimeRobustnessComponent: 0, symbolRobustnessComponent: 0, confidenceCalibrationComponent: 0, drawdownPenalty: 0, liquidationPenalty: 0 } };
      expect(computeStrategyHealthTransition(evaluated, "RETIRED", 40).action).toBe("none");
    });
  });
});
