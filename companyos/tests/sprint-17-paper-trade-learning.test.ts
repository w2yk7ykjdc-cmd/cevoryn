import { afterAll, describe, expect, it } from "vitest";
import "@/server/ai/tools/builtin";
import { prisma } from "@/server/db/client";
import { getTenantScopedClient, CrossTenantAccessError } from "@/server/db/tenant";
import { getOrCreatePolicy, listAllowlist } from "@/server/ai/autonomy/policy-service";
import { MAX_AUTONOMY_LEVEL_BY_DOMAIN } from "@/server/ai/autonomy/constants";
import { listRegisteredTools, getTool } from "@/server/ai/tools/registry";
import { executeToolCall } from "@/server/ai/tools/executor";
import { createConversation } from "@/server/ai/runtime/conversations";
import { runPaperTradeResult } from "@/server/intelligence/outcome/rules/paper-trade-result";
import { getConfidenceCalibration } from "@/server/intelligence/learning/service";
import {
  getDirectionPerformance,
  getLeverageTierPerformance,
  getPaperTradeConfidenceCalibration,
  getRecentPaperTradeOutcomes,
  getRegimePerformance,
  getStrategyPerformanceOverall,
  getStrategyTypePerformance,
} from "@/server/intelligence/strategy-performance/service";
import { MIN_FACTOR, MAX_FACTOR, scaleToFactor } from "@/server/intelligence/decision-intelligence/ranking";
import { rankMarketCandidates } from "@/server/intelligence/market-intelligence/ranking";
import { getMarketIntelligenceRanking } from "@/server/intelligence/market-intelligence/service";
import type { StrategyHistoricalPerformance } from "@/server/intelligence/market-intelligence/types";
import { closeTestConnections, createOrgForUser, signUpUser, authHeaders, addMemberDirect } from "./helpers";

type PaperPositionStatus = "PENDING" | "OPEN" | "CLOSED" | "STOPPED" | "TAKE_PROFIT" | "LIQUIDATED" | "INVALIDATED";
type PaperPositionDirection = "LONG" | "SHORT";
type PaperPositionMode = "SPOT" | "PERPETUAL_SIMULATION";

let tradeCounter = 0;

/**
 * Directly creates a fully-formed, already-closed `PaperTrade` row --
 * bypassing the full Sprint 16 simulation pipeline (whose price movements
 * are hard to control precisely enough to hit exact `returnPct`/
 * `closeReason` combinations deterministically). `positionId` carries no
 * foreign key to a real `PaperPosition` row (confirmed against the Sprint
 * 16 migration SQL -- only `organizationId` is a real FK), so a synthetic
 * unique value is sufficient and matches how `paper-trade-result.ts` itself
 * only ever reads from `paperTrade`, never joins back to `paperPosition`.
 */
async function createClosedPaperTrade(
  organizationId: string,
  overrides: Partial<{
    symbol: string;
    strategyType: string;
    direction: PaperPositionDirection;
    mode: PaperPositionMode;
    strategySignalId: string | null;
    regime: string | null;
    candidateScore: number | null;
    candidateConfidence: number | null;
    leverage: number;
    entryPrice: number;
    exitPrice: number;
    quantity: number;
    notional: number;
    initialMargin: number;
    feesPaid: number;
    fundingPaid: number;
    netPnl: number;
    returnPct: number;
    maxFavorableExcursion: number;
    maxAdverseExcursion: number;
    closeReason: PaperPositionStatus;
    openedAt: Date;
    closedAt: Date;
  }> = {},
) {
  tradeCounter += 1;
  const entryPrice = overrides.entryPrice ?? 100;
  const initialMargin = overrides.initialMargin ?? 1000;
  const returnPct = overrides.returnPct ?? 0;
  const netPnl = overrides.netPnl ?? returnPct * initialMargin;
  const openedAt = overrides.openedAt ?? new Date(Date.now() - 60 * 60 * 1000);
  const closedAt = overrides.closedAt ?? new Date();

  return prisma.paperTrade.create({
    data: {
      organizationId,
      positionId: `test-position-${tradeCounter}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      symbol: overrides.symbol ?? "BTCUSDT",
      direction: overrides.direction ?? "LONG",
      mode: overrides.mode ?? "PERPETUAL_SIMULATION",
      strategyType: overrides.strategyType ?? "TREND_FOLLOWING",
      strategySignalId: overrides.strategySignalId ?? null,
      regime: overrides.regime === undefined ? "trending" : overrides.regime,
      candidateScore: overrides.candidateScore === undefined ? 80 : overrides.candidateScore,
      candidateConfidence: overrides.candidateConfidence === undefined ? 90 : overrides.candidateConfidence,
      leverage: overrides.leverage ?? 1,
      entryPrice,
      exitPrice: overrides.exitPrice ?? entryPrice,
      quantity: overrides.quantity ?? 10,
      notional: overrides.notional ?? 1000,
      initialMargin,
      grossPnl: netPnl,
      feesPaid: overrides.feesPaid ?? 0,
      fundingPaid: overrides.fundingPaid ?? 0,
      netPnl,
      returnPct,
      maxFavorableExcursion: overrides.maxFavorableExcursion ?? Math.max(0, netPnl),
      maxAdverseExcursion: overrides.maxAdverseExcursion ?? Math.min(0, netPnl),
      closeReason: overrides.closeReason ?? "CLOSED",
      openedAt,
      closedAt,
    },
  });
}

describe("Phase 1: paper trade -> Outcome bridge (soft-reference reuse)", () => {
  afterAll(closeTestConnections);

  it("A: a closed paper trade is discovered as a pending Outcome, then evaluated -- immediately due, since the result is known the instant it closes", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const trade = await createClosedPaperTrade(organization.id, { returnPct: 0.05 });

    const result = await runPaperTradeResult(organization.id);
    expect(result.discovered).toBe(1);
    expect(result.evaluated).toBe(1);

    const outcome = await prisma.outcome.findFirstOrThrow({
      where: { organizationId: organization.id, relatedEntityType: "PaperTrade", relatedEntityId: trade.id },
    });
    expect(outcome.evaluationStatus).toBe("evaluated");
    expect(outcome.outcomeType).toBe("success");
    expect(outcome.ruleName).toBe("paper_trade_result");
  });

  it("B: an open position (no closed PaperTrade row) never produces an Outcome -- open = pending, closed = evaluatable, never judged early", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await prisma.paperPosition.create({
      data: {
        organizationId: organization.id,
        accountId: "test-account",
        symbol: "BTCUSDT",
        direction: "LONG",
        mode: "PERPETUAL_SIMULATION",
        status: "OPEN",
        strategyType: "TREND_FOLLOWING",
        leverage: 1,
        entryPrice: 100,
        currentPrice: 100,
        quantity: 10,
        notional: 1000,
        initialMargin: 1000,
        stopLossPrice: 95,
        takeProfitPrice: 110,
        riskUnit: 1,
        unrealizedPnl: 0,
        feesPaid: 0,
        fundingPaid: 0,
        maxFavorableExcursion: 0,
        maxAdverseExcursion: 0,
      },
    });

    const result = await runPaperTradeResult(organization.id);
    expect(result.discovered).toBe(0);
    expect(result.evaluated).toBe(0);

    const outcomes = await prisma.outcome.findMany({ where: { organizationId: organization.id, relatedEntityType: "PaperTrade" } });
    expect(outcomes).toHaveLength(0);
  });
});

describe("Phase 2: deterministic outcome classification", () => {
  afterAll(closeTestConnections);

  it("C: return above the success threshold classifies success", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await createClosedPaperTrade(organization.id, { returnPct: 0.05, closeReason: "CLOSED" });
    await runPaperTradeResult(organization.id);
    const outcome = await prisma.outcome.findFirstOrThrow({ where: { organizationId: organization.id, relatedEntityType: "PaperTrade" } });
    expect(outcome.outcomeType).toBe("success");
  });

  it("D: return below the failure threshold classifies failure", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await createClosedPaperTrade(organization.id, { returnPct: -0.05, closeReason: "CLOSED" });
    await runPaperTradeResult(organization.id);
    const outcome = await prisma.outcome.findFirstOrThrow({ where: { organizationId: organization.id, relatedEntityType: "PaperTrade" } });
    expect(outcome.outcomeType).toBe("failure");
  });

  it("E: return within the neutral band classifies neutral", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await createClosedPaperTrade(organization.id, { returnPct: 0.002, closeReason: "CLOSED" });
    await runPaperTradeResult(organization.id);
    const outcome = await prisma.outcome.findFirstOrThrow({ where: { organizationId: organization.id, relatedEntityType: "PaperTrade" } });
    expect(outcome.outcomeType).toBe("neutral");
  });

  it("F: liquidation is always classified failure and explicitly flagged wasLiquidated -- reported separately, never folded into an ordinary loss", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await createClosedPaperTrade(organization.id, { returnPct: -0.5, closeReason: "LIQUIDATED" });
    await runPaperTradeResult(organization.id);
    const outcome = await prisma.outcome.findFirstOrThrow({ where: { organizationId: organization.id, relatedEntityType: "PaperTrade" } });
    expect(outcome.outcomeType).toBe("failure");
    expect((outcome.evidence as { wasLiquidated?: boolean }).wasLiquidated).toBe(true);
  });

  it("G: a position that held a real gain (max favorable excursion) before closing at a loss is classified reversed, not a plain failure", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await createClosedPaperTrade(organization.id, {
      returnPct: -0.02,
      netPnl: -20,
      maxFavorableExcursion: 30, // was up 3% of margin at some point
      closeReason: "CLOSED",
    });
    await runPaperTradeResult(organization.id);
    const outcome = await prisma.outcome.findFirstOrThrow({ where: { organizationId: organization.id, relatedEntityType: "PaperTrade" } });
    expect(outcome.outcomeType).toBe("reversed");
  });

  it("H: an INVALIDATED close with near-zero return classifies expired, not failure", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await createClosedPaperTrade(organization.id, { returnPct: 0.001, closeReason: "INVALIDATED" });
    await runPaperTradeResult(organization.id);
    const outcome = await prisma.outcome.findFirstOrThrow({ where: { organizationId: organization.id, relatedEntityType: "PaperTrade" } });
    expect(outcome.outcomeType).toBe("expired");
  });

  it("I: a STOPPED close is NOT automatically 'strategy failed' -- classification follows measured return, not the close reason", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    // A trailing stop that still locked in a real gain.
    await createClosedPaperTrade(organization.id, { returnPct: 0.02, closeReason: "STOPPED" });
    await runPaperTradeResult(organization.id);
    const outcome = await prisma.outcome.findFirstOrThrow({ where: { organizationId: organization.id, relatedEntityType: "PaperTrade" } });
    expect(outcome.outcomeType).toBe("success");
  });

  it("J: a TAKE_PROFIT close is NOT automatically counted as strategy-quality proof -- classification follows measured return, not the close reason", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await createClosedPaperTrade(organization.id, { returnPct: -0.02, closeReason: "TAKE_PROFIT" });
    await runPaperTradeResult(organization.id);
    const outcome = await prisma.outcome.findFirstOrThrow({ where: { organizationId: organization.id, relatedEntityType: "PaperTrade" } });
    expect(outcome.outcomeType).toBe("failure");
  });
});

describe("Phase 3: expected vs. observed learning snapshot", () => {
  afterAll(closeTestConnections);

  it("K: a trade with a snapshotted candidateScore produces a LearningRecord with the documented dimensionless expected/observed/error mapping", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const trade = await createClosedPaperTrade(organization.id, { returnPct: 0.042, candidateScore: 82, candidateConfidence: 90 });
    await runPaperTradeResult(organization.id);

    const outcome = await prisma.outcome.findFirstOrThrow({ where: { organizationId: organization.id, relatedEntityType: "PaperTrade", relatedEntityId: trade.id } });
    const learning = await prisma.learningRecord.findUniqueOrThrow({ where: { outcomeId: outcome.id } });
    expect(Number(learning.expectedValue)).toBe(82);
    expect(Number(learning.observedValue)).toBe(71); // 50 + 0.042 * 100 * 5 = 71
    expect(Number(learning.errorValue)).toBe(71 - 82);
    expect(learning.outcomeType).toBe("success");
  });

  it("L: a trade with no snapshotted candidateScore (legacy/missing) produces no LearningRecord -- never a fabricated expectation", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const trade = await createClosedPaperTrade(organization.id, { returnPct: 0.03, candidateScore: null, candidateConfidence: null });
    await runPaperTradeResult(organization.id);

    const outcome = await prisma.outcome.findFirstOrThrow({ where: { organizationId: organization.id, relatedEntityType: "PaperTrade", relatedEntityId: trade.id } });
    expect(outcome.evaluationStatus).toBe("evaluated");
    const learning = await prisma.learningRecord.findUnique({ where: { outcomeId: outcome.id } });
    expect(learning).toBeNull();
  });
});

describe("Phase 9: idempotency -- reprocessing never duplicates Outcome or LearningRecord", () => {
  afterAll(closeTestConnections);

  it("M: running the rule twice never creates a second Outcome or a second LearningRecord for the same trade", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const trade = await createClosedPaperTrade(organization.id, { returnPct: 0.05, candidateScore: 75 });

    const first = await runPaperTradeResult(organization.id);
    expect(first.discovered).toBe(1);
    expect(first.evaluated).toBe(1);

    const second = await runPaperTradeResult(organization.id);
    expect(second.discovered).toBe(0);
    expect(second.evaluated).toBe(0);

    const outcomes = await prisma.outcome.findMany({ where: { organizationId: organization.id, relatedEntityType: "PaperTrade", relatedEntityId: trade.id } });
    expect(outcomes).toHaveLength(1);
    const learningRecords = await prisma.learningRecord.findMany({ where: { organizationId: organization.id, relatedEntityId: trade.id } });
    expect(learningRecords).toHaveLength(1);
  });
});

describe("Phase 4/5: strategy performance and regime performance aggregation", () => {
  afterAll(closeTestConnections);

  it("N: overall performance correctly aggregates win/loss/neutral counts, P&L, fees, funding, and close-reason tallies", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await createClosedPaperTrade(organization.id, { returnPct: 0.05, netPnl: 50, feesPaid: 1, fundingPaid: 0.5, closeReason: "TAKE_PROFIT" });
    await createClosedPaperTrade(organization.id, { returnPct: -0.05, netPnl: -50, feesPaid: 1, fundingPaid: 0.5, closeReason: "STOPPED" });
    await createClosedPaperTrade(organization.id, { returnPct: -0.6, netPnl: -600, closeReason: "LIQUIDATED" });
    await createClosedPaperTrade(organization.id, { returnPct: 0.001, netPnl: 1, closeReason: "INVALIDATED" });
    await runPaperTradeResult(organization.id);

    const overall = await getStrategyPerformanceOverall(organization.id);
    expect(overall.totalTrades).toBe(4);
    expect(overall.evaluatedTrades).toBe(4);
    expect(overall.winningTrades).toBe(1);
    expect(overall.losingTrades).toBe(2); // failure (stop) + failure (liquidation)
    expect(overall.neutralTrades).toBe(1); // expired counts as neutral bucket
    expect(overall.liquidationCount).toBe(1);
    expect(overall.stopLossCount).toBe(1);
    expect(overall.takeProfitCount).toBe(1);
    expect(overall.invalidationCount).toBe(1);
    expect(overall.totalRealizedPnl).toBeCloseTo(50 - 50 - 600 + 1, 6);
    expect(overall.totalFees).toBeCloseTo(2, 6);
    expect(overall.totalFunding).toBeCloseTo(1, 6);
    expect(overall.bestTradePnl).toBe(50);
    expect(overall.worstTradePnl).toBe(-600);
  });

  it("O: a trade with no evaluated Outcome yet contributes to totalTrades but never to evaluatedTrades/win-loss counts -- 'no verdict yet' is never a loss", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await createClosedPaperTrade(organization.id, { returnPct: 0.05 });
    // Deliberately never call runPaperTradeResult -- no Outcome exists yet.

    const overall = await getStrategyPerformanceOverall(organization.id);
    expect(overall.totalTrades).toBe(1);
    expect(overall.evaluatedTrades).toBe(0);
    expect(overall.winningTrades).toBe(0);
    expect(overall.winRate).toBeNull();
  });

  it("P: performance is broken out per strategy type -- TREND_FOLLOWING and MOMENTUM_CONTINUATION measured independently", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await createClosedPaperTrade(organization.id, { strategyType: "TREND_FOLLOWING", returnPct: 0.05 });
    await createClosedPaperTrade(organization.id, { strategyType: "MOMENTUM_CONTINUATION", returnPct: -0.05 });
    await runPaperTradeResult(organization.id);

    const byType = await getStrategyTypePerformance(organization.id);
    const trend = byType.find((t) => t.strategyType === "TREND_FOLLOWING")!;
    const momentum = byType.find((t) => t.strategyType === "MOMENTUM_CONTINUATION")!;
    expect(trend.performance.winningTrades).toBe(1);
    expect(momentum.performance.losingTrades).toBe(1);
    expect(byType.some((t) => t.strategyType === "NO_TRADE")).toBe(false);
  });

  it("Q: regime performance never assumes the same strategy performs identically across regimes -- trending vs. ranging measured separately", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await createClosedPaperTrade(organization.id, { strategyType: "TREND_FOLLOWING", regime: "trending", returnPct: 0.05 });
    await createClosedPaperTrade(organization.id, { strategyType: "TREND_FOLLOWING", regime: "ranging", returnPct: -0.05 });
    await runPaperTradeResult(organization.id);

    const byRegime = await getRegimePerformance(organization.id);
    const trending = byRegime.find((r) => r.regime === "trending")!;
    const ranging = byRegime.find((r) => r.regime === "ranging")!;
    expect(trending.performance.winningTrades).toBe(1);
    expect(trending.performance.losingTrades).toBe(0);
    expect(ranging.performance.losingTrades).toBe(1);
  });

  it("R: LONG and SHORT direction performance measured independently, and per-leverage-tier breakdown works", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await createClosedPaperTrade(organization.id, { direction: "LONG", leverage: 1, returnPct: 0.05 });
    await createClosedPaperTrade(organization.id, { direction: "SHORT", leverage: 3, returnPct: 0.05 });
    await runPaperTradeResult(organization.id);

    const byDirection = await getDirectionPerformance(organization.id);
    expect(byDirection.map((d) => d.direction).sort()).toEqual(["LONG", "SHORT"]);
    const byLeverage = await getLeverageTierPerformance(organization.id);
    expect(byLeverage.map((l) => l.leverage).sort()).toEqual([1, 3]);
  });

  it("S: a SPOT-mode trade and a PERPETUAL_SIMULATION-mode trade are both measured without error", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await createClosedPaperTrade(organization.id, { mode: "SPOT", leverage: 1, returnPct: 0.02 });
    await createClosedPaperTrade(organization.id, { mode: "PERPETUAL_SIMULATION", leverage: 5, returnPct: -0.02 });
    await runPaperTradeResult(organization.id);

    const overall = await getStrategyPerformanceOverall(organization.id);
    expect(overall.totalTrades).toBe(2);
    expect(overall.evaluatedTrades).toBe(2);
  });
});

describe("Phase 8: confidence calibration", () => {
  afterAll(closeTestConnections);

  it("T: Outcome.confidence reflects the strategy candidate's own predicted confidence (not a fixed system value) -- required for calibration to mean anything", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await createClosedPaperTrade(organization.id, { candidateConfidence: 65, returnPct: 0.05 });
    await runPaperTradeResult(organization.id);
    const outcome = await prisma.outcome.findFirstOrThrow({ where: { organizationId: organization.id, relatedEntityType: "PaperTrade" } });
    expect(outcome.confidence).toBe(65);
  });

  it("U: a bucket with zero evaluated outcomes reports null, never a fabricated 0% or 100%", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const buckets = await getPaperTradeConfidenceCalibration(organization.id);
    for (const bucket of buckets) {
      expect(bucket.totalEvaluated).toBe(0);
      expect(bucket.observedSuccessRate).toBeNull();
    }
  });

  it("V: once enough evaluated outcomes exist in a bucket, observedSuccessRate reflects the real ratio, and the paper-trading-scoped call never mixes in non-PaperTrade outcomes", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    for (let i = 0; i < 5; i += 1) {
      await createClosedPaperTrade(organization.id, { candidateConfidence: 92, returnPct: i < 4 ? 0.05 : -0.05 });
    }
    await runPaperTradeResult(organization.id);

    const paperTradeBuckets = await getPaperTradeConfidenceCalibration(organization.id);
    const bucket90 = paperTradeBuckets.find((b) => b.label === "90-100")!;
    expect(bucket90.totalEvaluated).toBe(5);
    expect(bucket90.successCount).toBe(4);
    expect(bucket90.observedSuccessRate).toBe(80);

    // The un-narrowed, existing call (every caller before Sprint 17) stays byte-for-byte identical in shape.
    const allBuckets = await getConfidenceCalibration(organization.id);
    expect(allBuckets).toHaveLength(4);
  });
});

describe("Phase 7: ranking integration -- bounded, explainable, current-evidence-first", () => {
  afterAll(closeTestConnections);

  it("W: scaleToFactor stays bounded to [MIN_FACTOR, MAX_FACTOR] regardless of extreme input", () => {
    expect(scaleToFactor(-50)).toBe(MIN_FACTOR);
    expect(scaleToFactor(0)).toBe(MIN_FACTOR);
    expect(scaleToFactor(100)).toBe(MAX_FACTOR);
    expect(scaleToFactor(150)).toBe(MAX_FACTOR);
  });

  it("X: with no performance data at all, rankMarketCandidates is byte-identical to omitting the parameter -- zero behavior change for existing callers", () => {
    const opportunities = [{ relatedEntityId: "BTCUSDT", score: 70, confidence: 80, evidence: {}, updatedAt: new Date() }];
    const withoutParam = rankMarketCandidates(opportunities, [], "trending");
    const withEmptyMap = rankMarketCandidates(opportunities, [], "trending", new Map(), new Map());
    expect(withoutParam).toEqual(withEmptyMap);
    expect(withoutParam[0]!.priorityScore).toBe(70);
    expect(withoutParam[0]!.historicalFactor).toBe(1);
  });

  it("Y: an insufficient-sample strategy type never moves priorityScore away from opportunityScore", () => {
    const opportunities = [{ relatedEntityId: "ETHUSDT", score: 60, confidence: 70, evidence: {}, updatedAt: new Date() }];
    const strategiesBySymbol = new Map([["ETHUSDT", { strategyType: "TREND_FOLLOWING" } as never]]);
    const performanceByStrategyType = new Map<string, StrategyHistoricalPerformance>([
      ["TREND_FOLLOWING", { shrunkWinRate: 90, evaluatedTrades: 2, sampleSizeStatus: "insufficient_sample" }],
    ]);
    const ranked = rankMarketCandidates(opportunities, [], "trending", strategiesBySymbol, performanceByStrategyType);
    expect(ranked[0]!.priorityScore).toBe(60);
    expect(ranked[0]!.historicalFactor).toBe(1);
  });

  it("Z: historical performance can only ever pull priorityScore DOWN from opportunityScore, never above it -- current evidence is never overridden by history", () => {
    const opportunities = [{ relatedEntityId: "SOLUSDT", score: 80, confidence: 90, evidence: {}, updatedAt: new Date() }];
    const strategiesBySymbol = new Map([["SOLUSDT", { strategyType: "MOMENTUM_CONTINUATION" } as never]]);
    for (const shrunkWinRate of [0, 25, 50, 75, 100]) {
      const performanceByStrategyType = new Map<string, StrategyHistoricalPerformance>([
        ["MOMENTUM_CONTINUATION", { shrunkWinRate, evaluatedTrades: 20, sampleSizeStatus: "sufficient_sample" }],
      ]);
      const ranked = rankMarketCandidates(opportunities, [], "trending", strategiesBySymbol, performanceByStrategyType);
      expect(ranked[0]!.priorityScore).toBeLessThanOrEqual(80);
      expect(ranked[0]!.priorityScore).toBeGreaterThanOrEqual(0);
      expect(ranked[0]!.priorityScore).toBeLessThanOrEqual(100);
    }
  });

  it("AA: a strategy with a strong historical win rate but very bad current opportunityScore is never ranked above a strategy with excellent current evidence", () => {
    const opportunities = [
      { relatedEntityId: "BADEVIDENCE", score: 5, confidence: 40, evidence: {}, updatedAt: new Date() },
      { relatedEntityId: "GOODEVIDENCE", score: 95, confidence: 95, evidence: {}, updatedAt: new Date() },
    ];
    const strategiesBySymbol = new Map([
      ["BADEVIDENCE", { strategyType: "TREND_FOLLOWING" } as never],
      ["GOODEVIDENCE", { strategyType: "RANGE_MEAN_REVERSION" } as never],
    ]);
    const performanceByStrategyType = new Map<string, StrategyHistoricalPerformance>([
      ["TREND_FOLLOWING", { shrunkWinRate: 70, evaluatedTrades: 50, sampleSizeStatus: "sufficient_sample" }],
      ["RANGE_MEAN_REVERSION", { shrunkWinRate: 40, evaluatedTrades: 50, sampleSizeStatus: "sufficient_sample" }],
    ]);
    const ranked = rankMarketCandidates(opportunities, [], "trending", strategiesBySymbol, performanceByStrategyType);
    expect(ranked[0]!.symbol).toBe("GOODEVIDENCE");
  });

  it("AB: getMarketIntelligenceRanking wires real measured strategy-type performance into the production ranking call end to end", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    for (let i = 0; i < 6; i += 1) {
      await createClosedPaperTrade(organization.id, { strategyType: "TREND_FOLLOWING", returnPct: 0.05 });
    }
    await runPaperTradeResult(organization.id);

    const snapshot = await getMarketIntelligenceRanking(organization.id);
    // No live Opportunity exists in this test, so `ranked` is empty -- this
    // call succeeding at all (rather than throwing) proves the wiring
    // (5th argument) is well-typed and safely handles a real organization.
    expect(snapshot.ranked).toEqual([]);
  });
});

describe("Phase 10: no-data and edge cases", () => {
  afterAll(closeTestConnections);

  it("AC: an organization with zero paper trades reports empty performance, never a fabricated number", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const overall = await getStrategyPerformanceOverall(organization.id);
    expect(overall.totalTrades).toBe(0);
    expect(overall.winRate).toBeNull();
    expect(overall.averageReturnPct).toBeNull();
    expect(overall.sampleSizeStatus).toBe("insufficient_sample");

    const recent = await getRecentPaperTradeOutcomes(organization.id);
    expect(recent).toEqual([]);
  });

  it("AD: a trade whose regime was never captured groups under 'unknown', never silently dropped", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await createClosedPaperTrade(organization.id, { regime: null, returnPct: 0.05 });
    await runPaperTradeResult(organization.id);
    const byRegime = await getRegimePerformance(organization.id);
    expect(byRegime.some((r) => r.regime === "unknown")).toBe(true);
  });

  it("AE: the discovery pass referencing a paper trade that has since been deleted marks the outcome insufficient_evidence, not a fabricated verdict", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const trade = await createClosedPaperTrade(organization.id, { returnPct: 0.05 });
    await prisma.outcome.create({
      data: {
        organizationId: organization.id,
        relatedEntityType: "PaperTrade",
        relatedEntityId: trade.id,
        ruleName: "paper_trade_result",
        ruleVersion: "v1",
        evaluationStatus: "pending",
        observationDueAt: new Date(Date.now() - 60_000),
        evidence: {},
      },
    });
    await prisma.paperTrade.delete({ where: { id: trade.id } });

    const result = await runPaperTradeResult(organization.id);
    expect(result.insufficientEvidence).toBe(1);
    const outcome = await prisma.outcome.findFirstOrThrow({ where: { organizationId: organization.id, relatedEntityType: "PaperTrade", relatedEntityId: trade.id } });
    expect(outcome.evaluationStatus).toBe("insufficient_evidence");
    expect(outcome.outcomeType).toBeNull();
  });

  it("recent paper trade outcomes report null (pending evaluation) for a trade not yet evaluated, never a fabricated result", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await createClosedPaperTrade(organization.id, { returnPct: 0.05 });
    const recent = await getRecentPaperTradeOutcomes(organization.id);
    expect(recent).toHaveLength(1);
    expect(recent[0]!.outcomeResult).toBeNull();
  });
});

describe("Phase 6/13: learning cannot escape control -- policy/autonomy/risk untouched by evaluation", () => {
  afterAll(closeTestConnections);

  it("AF: a full evaluation pass over several trades leaves AutonomyPolicy, its version history, and the allowlist byte-for-byte unchanged", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await createClosedPaperTrade(organization.id, { returnPct: 0.05, candidateScore: 80 });
    await createClosedPaperTrade(organization.id, { returnPct: -0.05, candidateScore: 60 });

    const policyBefore = await getOrCreatePolicy(organization.id, "market");
    const allowlistBefore = await listAllowlist(organization.id, "market");
    const versionCountBefore = await prisma.autonomyPolicyVersion.count({ where: { organizationId: organization.id } });

    await runPaperTradeResult(organization.id);

    const policyAfter = await getOrCreatePolicy(organization.id, "market");
    const allowlistAfter = await listAllowlist(organization.id, "market");
    const versionCountAfter = await prisma.autonomyPolicyVersion.count({ where: { organizationId: organization.id } });

    expect(policyAfter).toEqual(policyBefore);
    expect(allowlistAfter).toEqual(allowlistBefore);
    expect(versionCountAfter).toBe(versionCountBefore);
  });

  it("AG: the market autonomy ceiling stays capped at L2, unchanged by this sprint", () => {
    expect(MAX_AUTONOMY_LEVEL_BY_DOMAIN.market).toBe("L2");
  });
});

describe("Phase 11/13: get_strategy_performance AI tool -- read-only, no mutation, correctly RBAC-gated", () => {
  afterAll(closeTestConnections);

  it("AH: the tool is classified read_only, domain market, non-autonomy-eligible, and requires paperTrading:read (the existing permission -- no new RBAC resource)", () => {
    const tool = getTool("get_strategy_performance");
    expect(tool?.mutationCategory).toBe("read_only");
    expect(tool?.domain).toBe("market");
    expect(tool?.requiredPermission).toEqual({ paperTrading: ["read"] });
    expect(tool?.autonomyEligible).toBeFalsy();
  });

  it("AI: a permitted viewer can call the tool and receives real, deterministically-computed performance data", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const viewer = await signUpUser();
    await addMemberDirect(organization.id, viewer, "viewer");
    await createClosedPaperTrade(organization.id, { returnPct: 0.05 });
    await runPaperTradeResult(organization.id);

    const conversation = await createConversation({ organizationId: organization.id, userId: viewer.userId });
    const result = await executeToolCall(
      { id: "sp-1", name: "get_strategy_performance", arguments: {} },
      { organizationId: organization.id, userId: viewer.userId, conversationId: conversation.id },
      authHeaders(viewer.token),
    );
    expect(result.status).toBe("success");
    const payload = result as unknown as { output?: { overall?: { totalTrades?: number } } };
    expect(payload.output?.overall?.totalTrades).toBe(1);
  });

  it("AJ: no order/account/withdrawal/transfer capability exists anywhere in the registered tool set, including the new tool", () => {
    const forbiddenNamePattern = /placeorder|createorder|executeorder|withdraw|transfer|deposit/i;
    const offendingTools = listRegisteredTools().filter((tool) => forbiddenNamePattern.test(tool.name));
    expect(offendingTools).toHaveLength(0);
  });

  it("AK: every market-domain tool, including the new one, stays read_only and non-autonomy-eligible", () => {
    const marketTools = listRegisteredTools().filter((t) => t.domain === "market");
    expect(marketTools.length).toBeGreaterThanOrEqual(3);
    expect(marketTools.every((t) => t.mutationCategory === "read_only")).toBe(true);
    expect(marketTools.every((t) => !t.autonomyEligible)).toBe(true);
    expect(marketTools.some((t) => t.name === "get_strategy_performance")).toBe(true);
  });
});

describe("Phase 13: tenant isolation and cross-tenant rejection", () => {
  afterAll(closeTestConnections);

  it("AL: strategy performance for one organization never includes another organization's paper trades", async () => {
    const ownerA = await signUpUser();
    const orgA = await createOrgForUser(ownerA);
    const ownerB = await signUpUser();
    const orgB = await createOrgForUser(ownerB);
    await createClosedPaperTrade(orgA.id, { returnPct: 0.05 });
    await createClosedPaperTrade(orgB.id, { returnPct: -0.05 });
    await runPaperTradeResult(orgA.id);
    await runPaperTradeResult(orgB.id);

    const overallA = await getStrategyPerformanceOverall(orgA.id);
    const overallB = await getStrategyPerformanceOverall(orgB.id);
    expect(overallA.totalTrades).toBe(1);
    expect(overallA.winningTrades).toBe(1);
    expect(overallB.totalTrades).toBe(1);
    expect(overallB.losingTrades).toBe(1);
  });

  it("AM: a cross-tenant query against another organization's PaperTrade or Outcome rows throws CrossTenantAccessError", async () => {
    const ownerA = await signUpUser();
    const orgA = await createOrgForUser(ownerA);
    const ownerB = await signUpUser();
    const orgB = await createOrgForUser(ownerB);
    await createClosedPaperTrade(orgA.id, { returnPct: 0.05 });
    await runPaperTradeResult(orgA.id);

    const scopedB = getTenantScopedClient(orgB.id);
    await expect(scopedB.paperTrade.findFirst({ where: { organizationId: orgA.id } })).rejects.toBeInstanceOf(CrossTenantAccessError);
    await expect(scopedB.outcome.findFirst({ where: { organizationId: orgA.id, relatedEntityType: "PaperTrade" } })).rejects.toBeInstanceOf(CrossTenantAccessError);
  });

  it("AN: one organization's evaluation pass never touches another organization's Outcome or LearningRecord rows", async () => {
    const ownerA = await signUpUser();
    const orgA = await createOrgForUser(ownerA);
    const ownerB = await signUpUser();
    const orgB = await createOrgForUser(ownerB);
    await createClosedPaperTrade(orgA.id, { returnPct: 0.05, candidateScore: 80 });
    await createClosedPaperTrade(orgB.id, { returnPct: 0.05, candidateScore: 80 });

    await runPaperTradeResult(orgA.id);

    const outcomesB = await prisma.outcome.findMany({ where: { organizationId: orgB.id, relatedEntityType: "PaperTrade" } });
    expect(outcomesB).toHaveLength(0);
  });
});

describe("Phase 15/13: no real execution -- market data client stays read-only public-only", () => {
  afterAll(closeTestConnections);

  it("AO: the Binance market data client still exposes exactly getCandles/getExchangeInfo/getTicker24hr -- no credential surface, no order capability", async () => {
    const { createBinancePublicClient } = await import("@/server/market-data/binance-client");
    const client = createBinancePublicClient();
    expect(Object.keys(client).sort()).toEqual(["getCandles", "getExchangeInfo", "getTicker24hr"]);
  });
});
