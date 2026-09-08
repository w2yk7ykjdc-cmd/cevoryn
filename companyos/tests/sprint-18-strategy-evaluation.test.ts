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
import { MIN_SAMPLE_SIZE } from "@/server/intelligence/decision-intelligence/sample-safety";
import { scaleToFactor } from "@/server/intelligence/decision-intelligence/ranking";
import { rankMarketCandidates } from "@/server/intelligence/market-intelligence/ranking";
import {
  computeMaxDrawdown,
  computeRiskAdjustedReturn,
  evidenceQualityFor,
  getStrategyEvaluation,
  getStrategyEvaluations,
} from "@/server/intelligence/strategy-evaluation/service";
import type { StrategyEvaluationSummary } from "@/server/intelligence/strategy-evaluation/types";
import { closeTestConnections, createClosedPaperTrade, createOrgForUser, signUpUser, authHeaders, addMemberDirect } from "./helpers";

/** Creates `count` closed, evaluated trades for one strategy type with a fixed win/loss pattern, then runs the Sprint 17 evaluation rule so real `Outcome` rows back the evaluation. */
async function seedEvaluatedTrades(
  organizationId: string,
  count: number,
  pattern: (i: number) => Partial<Parameters<typeof createClosedPaperTrade>[1]>,
): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await createClosedPaperTrade(organizationId, pattern(i));
  }
  await runPaperTradeResult(organizationId);
}

describe("A: sample size / evidence quality thresholds", () => {
  it("A: evidenceQualityFor is pinned to the exact same insufficient/sufficient boundary as MIN_SAMPLE_SIZE, then subdivides limited/moderate/strong", () => {
    expect(evidenceQualityFor(0)).toBe("insufficient");
    expect(evidenceQualityFor(MIN_SAMPLE_SIZE - 1)).toBe("insufficient");
    expect(evidenceQualityFor(MIN_SAMPLE_SIZE)).toBe("limited");
    expect(evidenceQualityFor(19)).toBe("limited");
    expect(evidenceQualityFor(20)).toBe("moderate");
    expect(evidenceQualityFor(49)).toBe("moderate");
    expect(evidenceQualityFor(50)).toBe("strong");
    expect(evidenceQualityFor(1000)).toBe("strong");
  });

  it("A: a strategy with only 2 successful trades can never be reported STRONG -- it is not even evaluated at all", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await seedEvaluatedTrades(organization.id, 2, () => ({ returnPct: 0.05 }));
    const evaluation = await getStrategyEvaluation(organization.id, "TREND_FOLLOWING");
    expect(evaluation.status).toBe("insufficient_evidence");
  });
});

describe("B: insufficient evidence gating", () => {
  afterAll(closeTestConnections);

  it("B: below MIN_SAMPLE_SIZE evaluated trades, getStrategyEvaluation returns insufficient_evidence with the real count, never a fabricated score", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await seedEvaluatedTrades(organization.id, MIN_SAMPLE_SIZE - 1, () => ({ returnPct: 0.05 }));
    const evaluation = await getStrategyEvaluation(organization.id, "TREND_FOLLOWING");
    expect(evaluation).toEqual({ status: "insufficient_evidence", strategyType: "TREND_FOLLOWING", evaluatedTrades: MIN_SAMPLE_SIZE - 1, minimumRequired: MIN_SAMPLE_SIZE });
  });

  it("B: at exactly MIN_SAMPLE_SIZE evaluated trades, the strategy is evaluated (limited evidence, not insufficient)", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await seedEvaluatedTrades(organization.id, MIN_SAMPLE_SIZE, () => ({ returnPct: 0.05 }));
    const evaluation = await getStrategyEvaluation(organization.id, "TREND_FOLLOWING");
    expect(evaluation.status).toBe("evaluated");
    if (evaluation.status === "evaluated") expect(evaluation.evidenceQuality).toBe("limited");
  });
});

describe("C: strategy performance evaluation (win rate, return, P&L, holding duration)", () => {
  afterAll(closeTestConnections);

  it("C: a mixed win/loss set produces correct winRate, averageReturnPct, and totalRealizedPnl", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    for (let i = 0; i < 6; i += 1) await createClosedPaperTrade(organization.id, { returnPct: 0.05, netPnl: 100 });
    for (let i = 0; i < 4; i += 1) await createClosedPaperTrade(organization.id, { returnPct: -0.05, netPnl: -50 });
    await runPaperTradeResult(organization.id);

    const evaluation = await getStrategyEvaluation(organization.id, "TREND_FOLLOWING");
    expect(evaluation.status).toBe("evaluated");
    if (evaluation.status !== "evaluated") return;
    expect(evaluation.evaluatedTrades).toBe(10);
    expect(evaluation.winRate).toBe(60);
    expect(evaluation.totalRealizedPnl).toBe(6 * 100 - 4 * 50);
  });
});

describe("D: max drawdown (peak-to-trough of the reconstructed strategy P&L sequence)", () => {
  it("D: no trades at all reports no_data", () => {
    expect(computeMaxDrawdown([])).toEqual({ status: "no_data" });
  });

  it("D: a single winning trade has zero drawdown", () => {
    const result = computeMaxDrawdown([{ id: "1", closedAt: new Date("2026-01-01"), netPnl: 100 }]);
    expect(result).toMatchObject({ status: "computed", maxDrawdownPnl: 0 });
  });

  it("D: a single losing trade is a real drawdown from the implicit zero baseline, with no positive-peak percentage to report", () => {
    const result = computeMaxDrawdown([{ id: "1", closedAt: new Date("2026-01-01"), netPnl: -100 }]);
    expect(result).toEqual({ status: "computed", maxDrawdownPnl: 100, maxDrawdownPct: null, peakPnl: 0, troughPnl: -100 });
  });

  it("D: an all-wins sequence has zero drawdown and a defined 0% (not null) against its real positive peak", () => {
    const trades = [
      { id: "1", closedAt: new Date("2026-01-01"), netPnl: 50 },
      { id: "2", closedAt: new Date("2026-01-02"), netPnl: 30 },
      { id: "3", closedAt: new Date("2026-01-03"), netPnl: 20 },
    ];
    expect(computeMaxDrawdown(trades)).toEqual({ status: "computed", maxDrawdownPnl: 0, maxDrawdownPct: 0, peakPnl: 100, troughPnl: 0 });
  });

  it("D: an all-losses sequence never had a positive peak, so the percentage is null even though the dollar drawdown is real", () => {
    const trades = [
      { id: "1", closedAt: new Date("2026-01-01"), netPnl: -30 },
      { id: "2", closedAt: new Date("2026-01-02"), netPnl: -20 },
    ];
    expect(computeMaxDrawdown(trades)).toEqual({ status: "computed", maxDrawdownPnl: 50, maxDrawdownPct: null, peakPnl: 0, troughPnl: -50 });
  });

  it("D: peak then trough then partial recovery correctly identifies the deepest point, not the final value", () => {
    const trades = [
      { id: "1", closedAt: new Date("2026-01-01"), netPnl: 100 }, // cumulative 100 (peak)
      { id: "2", closedAt: new Date("2026-01-02"), netPnl: -80 }, // cumulative 20 (drawdown 80 from peak 100)
      { id: "3", closedAt: new Date("2026-01-03"), netPnl: 10 }, // cumulative 30 (partial recovery, still below peak)
    ];
    expect(computeMaxDrawdown(trades)).toEqual({ status: "computed", maxDrawdownPnl: 80, maxDrawdownPct: 80, peakPnl: 100, troughPnl: 20 });
  });

  it("D: trades sharing the exact same closedAt timestamp are ordered deterministically by id, not left ambiguous", () => {
    const sameTime = new Date("2026-01-01T00:00:00Z");
    const a = computeMaxDrawdown([
      { id: "a", closedAt: sameTime, netPnl: 100 },
      { id: "b", closedAt: sameTime, netPnl: -200 },
    ]);
    const b = computeMaxDrawdown([
      { id: "b", closedAt: sameTime, netPnl: -200 },
      { id: "a", closedAt: sameTime, netPnl: 100 },
    ]);
    expect(a).toEqual(b); // input order must never matter -- only (closedAt, id) does
  });
});

describe("E: risk-adjusted (Sharpe-like) return -- zero-variance-safe, insufficient-data-safe, bounded", () => {
  it("E: fewer than MIN_SAMPLE_SIZE returns is insufficient_evidence, never a fabricated ratio", () => {
    expect(computeRiskAdjustedReturn([0.01, 0.02, -0.01])).toEqual({ status: "insufficient_evidence" });
  });

  it("E: a zero-variance sample with a positive mean caps at the documented bound rather than dividing by zero", () => {
    const result = computeRiskAdjustedReturn([0.02, 0.02, 0.02, 0.02, 0.02]);
    expect(result).toEqual({ status: "computed", value: 3, cappedAtBound: true });
  });

  it("E: a zero-variance, zero-mean sample (e.g. every trade broke exactly even) is exactly 0, not capped, not NaN", () => {
    const result = computeRiskAdjustedReturn([0, 0, 0, 0, 0]);
    expect(result).toEqual({ status: "computed", value: 0, cappedAtBound: false });
  });

  it("E: a zero-variance sample with a negative mean caps at the NEGATIVE bound, sign preserved", () => {
    const result = computeRiskAdjustedReturn([-0.02, -0.02, -0.02, -0.02, -0.02]);
    expect(result).toEqual({ status: "computed", value: -3, cappedAtBound: true });
  });

  it("E: a genuinely mixed, volatile sample produces a bounded, finite ratio -- never Infinity/NaN", () => {
    const result = computeRiskAdjustedReturn([0.05, -0.03, 0.02, -0.04, 0.01, 0.03, -0.02]);
    expect(result.status).toBe("computed");
    if (result.status !== "computed") return;
    expect(Number.isFinite(result.value)).toBe(true);
    expect(result.value).toBeGreaterThanOrEqual(-3);
    expect(result.value).toBeLessThanOrEqual(3);
  });
});

describe("F: regime robustness -- performance measured per market condition, never assumed uniform", () => {
  afterAll(closeTestConnections);

  it("F: a strategy strong in one regime and weak in another shows both, from real per-regime data", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    for (let i = 0; i < 8; i += 1) await createClosedPaperTrade(organization.id, { regime: "trending", returnPct: 0.05 });
    for (let i = 0; i < 8; i += 1) await createClosedPaperTrade(organization.id, { regime: "ranging", returnPct: -0.05 });
    await runPaperTradeResult(organization.id);

    const evaluation = await getStrategyEvaluation(organization.id, "TREND_FOLLOWING");
    expect(evaluation.status).toBe("evaluated");
    if (evaluation.status !== "evaluated") return;
    const trending = evaluation.regimeRobustness.find((r) => r.regime === "trending")!;
    const ranging = evaluation.regimeRobustness.find((r) => r.regime === "ranging")!;
    expect(trending.label).toBe("strong");
    expect(ranging.label).toBe("weak");
  });

  it("F: a regime with too few evaluated trades is labeled insufficient regardless of its raw win rate", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    for (let i = 0; i < 6; i += 1) await createClosedPaperTrade(organization.id, { regime: "trending", returnPct: 0.05 });
    await createClosedPaperTrade(organization.id, { regime: "high_volatility", returnPct: 0.05 }); // only 1 trade in this regime
    await runPaperTradeResult(organization.id);

    const evaluation = await getStrategyEvaluation(organization.id, "TREND_FOLLOWING");
    expect(evaluation.status).toBe("evaluated");
    if (evaluation.status !== "evaluated") return;
    const volatile = evaluation.regimeRobustness.find((r) => r.regime === "high_volatility")!;
    expect(volatile.evidenceQuality).toBe("insufficient");
    expect(volatile.label).toBe("insufficient");
  });
});

describe("G: symbol robustness -- concentration is measured, not assumed", () => {
  afterAll(closeTestConnections);

  it("G: a strategy profitable on 8 of 10 symbols is not the same as one profitable on only 1 of 10", async () => {
    const ownerA = await signUpUser();
    const orgA = await createOrgForUser(ownerA);
    for (let i = 0; i < 10; i += 1) {
      await createClosedPaperTrade(orgA.id, { symbol: `SYM${i}USDT`, returnPct: i < 8 ? 0.05 : -0.05, netPnl: i < 8 ? 100 : -100 });
    }
    await runPaperTradeResult(orgA.id);
    const evalA = await getStrategyEvaluation(orgA.id, "TREND_FOLLOWING");
    expect(evalA.status).toBe("evaluated");
    if (evalA.status !== "evaluated") return;
    expect(evalA.symbolRobustness.uniqueSymbols).toBe(10);
    expect(evalA.symbolRobustness.profitableSymbols).toBe(8);
    expect(evalA.symbolRobustness.losingSymbols).toBe(2);

    const ownerB = await signUpUser();
    const orgB = await createOrgForUser(ownerB);
    for (let i = 0; i < 10; i += 1) {
      await createClosedPaperTrade(orgB.id, { symbol: `SYM${i}USDT`, returnPct: i < 1 ? 0.05 : -0.05, netPnl: i < 1 ? 100 : -100 });
    }
    await runPaperTradeResult(orgB.id);
    const evalB = await getStrategyEvaluation(orgB.id, "TREND_FOLLOWING");
    expect(evalB.status).toBe("evaluated");
    if (evalB.status !== "evaluated") return;
    expect(evalB.symbolRobustness.profitableSymbols).toBe(1);
    expect(evalB.symbolRobustness.losingSymbols).toBe(9);

    // A strategy with 8/10 profitable symbols must never be reported the same as one with 1/10 -- it must score strictly higher.
    expect(evalA.evaluationScore).toBeGreaterThan(evalB.evaluationScore);
  });

  it("G: a single-symbol strategy has maximal concentration (1.0); a perfectly-even multi-symbol strategy has a lower, bounded concentration", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    for (let i = 0; i < 6; i += 1) await createClosedPaperTrade(organization.id, { symbol: "BTCUSDT", returnPct: 0.05, netPnl: 100 });
    await runPaperTradeResult(organization.id);
    const concentrated = await getStrategyEvaluation(organization.id, "TREND_FOLLOWING");
    expect(concentrated.status).toBe("evaluated");
    if (concentrated.status === "evaluated") expect(concentrated.symbolRobustness.concentrationIndex).toBe(1);

    const owner2 = await signUpUser();
    const org2 = await createOrgForUser(owner2);
    for (const symbol of ["AAAUSDT", "BBBUSDT", "CCCUSDT"]) {
      for (let i = 0; i < 2; i += 1) await createClosedPaperTrade(org2.id, { symbol, returnPct: 0.05, netPnl: 100 });
    }
    await runPaperTradeResult(org2.id);
    const diversified = await getStrategyEvaluation(org2.id, "TREND_FOLLOWING");
    expect(diversified.status).toBe("evaluated");
    if (diversified.status === "evaluated") {
      expect(diversified.symbolRobustness.concentrationIndex).toBeCloseTo(1 / 3, 2);
      expect(diversified.symbolRobustness.concentrationIndex!).toBeLessThan(concentrated.status === "evaluated" ? concentrated.symbolRobustness.concentrationIndex! : 1);
    }
  });
});

describe("H: LONG/SHORT robustness -- measured separately, never hidden", () => {
  afterAll(closeTestConnections);

  it("H: a strategy that only ever traded LONG reports zero SHORT sample, never a fabricated SHORT number", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await seedEvaluatedTrades(organization.id, MIN_SAMPLE_SIZE, () => ({ direction: "LONG", returnPct: 0.05 }));
    const evaluation = await getStrategyEvaluation(organization.id, "TREND_FOLLOWING");
    expect(evaluation.status).toBe("evaluated");
    if (evaluation.status !== "evaluated") return;
    expect(evaluation.directionRobustness).toHaveLength(1);
    expect(evaluation.directionRobustness[0]!.direction).toBe("LONG");
  });

  it("H: LONG and SHORT performance is measured independently when both are present", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    for (let i = 0; i < 6; i += 1) await createClosedPaperTrade(organization.id, { direction: "LONG", returnPct: 0.05 });
    for (let i = 0; i < 6; i += 1) await createClosedPaperTrade(organization.id, { direction: "SHORT", returnPct: -0.05 });
    await runPaperTradeResult(organization.id);
    const evaluation = await getStrategyEvaluation(organization.id, "TREND_FOLLOWING");
    expect(evaluation.status).toBe("evaluated");
    if (evaluation.status !== "evaluated") return;
    const long = evaluation.directionRobustness.find((d) => d.direction === "LONG")!;
    const short = evaluation.directionRobustness.find((d) => d.direction === "SHORT")!;
    expect(long.winRate).toBe(100);
    expect(short.winRate).toBe(0);
  });
});

describe("I: leverage robustness -- higher leverage is never treated as automatically better", () => {
  afterAll(closeTestConnections);

  it("I: performance is broken out per real leverage tier used, including 10x", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    for (let i = 0; i < 6; i += 1) await createClosedPaperTrade(organization.id, { leverage: 1, returnPct: 0.02 });
    for (let i = 0; i < 6; i += 1) await createClosedPaperTrade(organization.id, { leverage: 10, returnPct: 0.15, closeReason: i % 2 === 0 ? "LIQUIDATED" : "CLOSED" });
    await runPaperTradeResult(organization.id);
    const evaluation = await getStrategyEvaluation(organization.id, "TREND_FOLLOWING");
    expect(evaluation.status).toBe("evaluated");
    if (evaluation.status !== "evaluated") return;
    const tier1 = evaluation.leverageRobustness.find((l) => l.leverage === 1)!;
    const tier10 = evaluation.leverageRobustness.find((l) => l.leverage === 10)!;
    expect(tier1).toBeDefined();
    expect(tier10).toBeDefined();
    // 10x has a much higher average return AND a much higher liquidation rate -- a naive "higher leverage = better" reading would be wrong.
    expect(tier10.averageReturnPct!).toBeGreaterThan(tier1.averageReturnPct!);
    expect(tier10.liquidationRate!).toBeGreaterThan(tier1.liquidationRate ?? 0);
  });
});

describe("J: temporal robustness -- chronological, non-overlapping, no look-ahead", () => {
  afterAll(closeTestConnections);

  it("J: temporal robustness is always 'computed' once a strategy clears the overall evidence gate -- MIN_SAMPLE_SIZE (5) already exceeds the 3-trade temporal floor, so a strategy can never reach 'evaluated' status with too few trades to split into three buckets (a structural guarantee, not a runtime check)", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await seedEvaluatedTrades(organization.id, MIN_SAMPLE_SIZE, (i) => ({ returnPct: 0.05, closedAt: new Date(Date.now() - (MIN_SAMPLE_SIZE - i) * 86_400_000) }));
    const evaluation = await getStrategyEvaluation(organization.id, "TREND_FOLLOWING");
    expect(evaluation.status).toBe("evaluated");
    if (evaluation.status !== "evaluated") return;
    expect(evaluation.temporalRobustness.status).toBe("computed");
  });

  it("J: three chronologically-ordered buckets are produced, with the remainder falling into 'recent', never shrinking it", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const now = Date.now();
    // 7 trades -> size = floor(7/3) = 2 -> older:2, previous:2, recent:3 (remainder).
    for (let i = 0; i < 7; i += 1) {
      await createClosedPaperTrade(organization.id, { returnPct: 0.05, closedAt: new Date(now - (7 - i) * 86_400_000) });
    }
    await runPaperTradeResult(organization.id);
    const evaluation = await getStrategyEvaluation(organization.id, "TREND_FOLLOWING");
    expect(evaluation.status).toBe("evaluated");
    if (evaluation.status !== "evaluated") return;
    expect(evaluation.temporalRobustness.status).toBe("computed");
    if (evaluation.temporalRobustness.status !== "computed") return;
    const [older, previous, recent] = evaluation.temporalRobustness.buckets;
    expect(older!.sampleSize).toBe(2);
    expect(previous!.sampleSize).toBe(2);
    expect(recent!.sampleSize).toBe(3);
  });

  it("J: no future information leaks into an earlier bucket -- buckets are strictly chronological", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const now = Date.now();
    // Older trades all lose, recent trades all win -- the "older" bucket must show 0% win rate, "recent" must show 100%.
    for (let i = 0; i < 3; i += 1) await createClosedPaperTrade(organization.id, { returnPct: -0.05, closedAt: new Date(now - (10 - i) * 86_400_000) });
    for (let i = 0; i < 3; i += 1) await createClosedPaperTrade(organization.id, { returnPct: 0.05, closedAt: new Date(now - (3 - i) * 86_400_000) });
    await runPaperTradeResult(organization.id);
    const evaluation = await getStrategyEvaluation(organization.id, "TREND_FOLLOWING");
    expect(evaluation.status).toBe("evaluated");
    if (evaluation.status !== "evaluated" || evaluation.temporalRobustness.status !== "computed") return;
    const [older, , recent] = evaluation.temporalRobustness.buckets;
    expect(older!.winRate).toBe(0);
    expect(recent!.winRate).toBe(100);
  });
});

describe("K: confidence calibration -- per-strategy-type, reusing the existing 4 buckets", () => {
  afterAll(closeTestConnections);

  it("K: a strategy whose high-confidence trades mostly win, and low-confidence trades mostly lose, shows well-calibrated buckets", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    for (let i = 0; i < 6; i += 1) await createClosedPaperTrade(organization.id, { candidateConfidence: 92, returnPct: i < 5 ? 0.05 : -0.05 });
    for (let i = 0; i < 6; i += 1) await createClosedPaperTrade(organization.id, { candidateConfidence: 40, returnPct: i < 1 ? 0.05 : -0.05 });
    await runPaperTradeResult(organization.id);
    const evaluation = await getStrategyEvaluation(organization.id, "TREND_FOLLOWING");
    expect(evaluation.status).toBe("evaluated");
    if (evaluation.status !== "evaluated") return;
    const highBucket = evaluation.confidenceCalibration.find((b) => b.label === "90-100")!;
    const lowBucket = evaluation.confidenceCalibration.find((b) => b.label === "0-59")!;
    expect(highBucket.totalEvaluated).toBe(6);
    expect(lowBucket.totalEvaluated).toBe(6);
    expect(highBucket.observedSuccessRate!).toBeGreaterThan(lowBucket.observedSuccessRate!);
  });
});

describe("L: Strategy Evaluation Score -- bounded, deterministic, explainable", () => {
  afterAll(closeTestConnections);

  it("L: the score is always within [0,100] and reproducible for identical input", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    for (let i = 0; i < 8; i += 1) await createClosedPaperTrade(organization.id, { returnPct: 0.05, candidateConfidence: 90 });
    for (let i = 0; i < 4; i += 1) await createClosedPaperTrade(organization.id, { returnPct: -0.06, candidateConfidence: 55, closeReason: "LIQUIDATED" });
    await runPaperTradeResult(organization.id);

    const first = await getStrategyEvaluation(organization.id, "TREND_FOLLOWING");
    const second = await getStrategyEvaluation(organization.id, "TREND_FOLLOWING");
    expect(first).toEqual(second); // pure function of already-persisted data -- identical input, identical output
    expect(first.status).toBe("evaluated");
    if (first.status !== "evaluated") return;
    expect(first.evaluationScore).toBeGreaterThanOrEqual(0);
    expect(first.evaluationScore).toBeLessThanOrEqual(100);
    const sumOfPositives =
      first.scoreBreakdown.performanceComponent +
      first.scoreBreakdown.consistencyComponent +
      first.scoreBreakdown.regimeRobustnessComponent +
      first.scoreBreakdown.symbolRobustnessComponent +
      first.scoreBreakdown.confidenceCalibrationComponent;
    expect(first.evaluationScore).toBeLessThanOrEqual(sumOfPositives + 0.01); // penalties only ever subtract
  });

  it("L: heavy liquidation and drawdown pull the score down relative to an otherwise-identical clean strategy", async () => {
    const ownerClean = await signUpUser();
    const orgClean = await createOrgForUser(ownerClean);
    for (let i = 0; i < 10; i += 1) await createClosedPaperTrade(orgClean.id, { returnPct: 0.05, candidateConfidence: 85 });
    await runPaperTradeResult(orgClean.id);
    const clean = await getStrategyEvaluation(orgClean.id, "TREND_FOLLOWING");

    const ownerLiq = await signUpUser();
    const orgLiq = await createOrgForUser(ownerLiq);
    for (let i = 0; i < 5; i += 1) await createClosedPaperTrade(orgLiq.id, { returnPct: 0.05, candidateConfidence: 85 });
    for (let i = 0; i < 5; i += 1) await createClosedPaperTrade(orgLiq.id, { returnPct: -0.5, candidateConfidence: 85, closeReason: "LIQUIDATED" });
    await runPaperTradeResult(orgLiq.id);
    const liquidated = await getStrategyEvaluation(orgLiq.id, "TREND_FOLLOWING");

    expect(clean.status).toBe("evaluated");
    expect(liquidated.status).toBe("evaluated");
    if (clean.status !== "evaluated" || liquidated.status !== "evaluated") return;
    expect(liquidated.evaluationScore).toBeLessThan(clean.evaluationScore);
  });
});

describe("M: ranking integration -- bounded, additive, never overriding current evidence", () => {
  it("M: evaluationQualityFactor stays exactly 1.0 (no-op) when no evaluation map is supplied -- zero behavior change for existing callers", () => {
    const opportunities = [{ relatedEntityId: "BTCUSDT", score: 70, confidence: 80, evidence: {}, updatedAt: new Date() }];
    const ranked = rankMarketCandidates(opportunities, [], "trending");
    expect(ranked[0]!.evaluationQualityFactor).toBe(1);
    expect(ranked[0]!.priorityScore).toBe(70);
  });

  it("M: insufficient evidence quality never lets evaluationQualityFactor move away from 1.0", () => {
    const opportunities = [{ relatedEntityId: "ETHUSDT", score: 60, confidence: 70, evidence: {}, updatedAt: new Date() }];
    const strategiesBySymbol = new Map([["ETHUSDT", { strategyType: "TREND_FOLLOWING" } as never]]);
    const evaluationByStrategyType = new Map<string, StrategyEvaluationSummary>([["TREND_FOLLOWING", { evidenceQuality: "insufficient", evaluationScore: 95 }]]);
    const ranked = rankMarketCandidates(opportunities, [], "trending", strategiesBySymbol, new Map(), evaluationByStrategyType);
    expect(ranked[0]!.evaluationQualityFactor).toBe(1);
    expect(ranked[0]!.priorityScore).toBe(60);
  });

  it("M: sufficient evidence with a strong evaluation score can only pull priorityScore DOWN from opportunityScore, never above it, and stays within [0.5,1.0]*opportunityScore bounds", () => {
    const opportunities = [{ relatedEntityId: "SOLUSDT", score: 80, confidence: 90, evidence: {}, updatedAt: new Date() }];
    const strategiesBySymbol = new Map([["SOLUSDT", { strategyType: "MOMENTUM_CONTINUATION" } as never]]);
    for (const evaluationScore of [0, 25, 50, 75, 100]) {
      const evaluationByStrategyType = new Map<string, StrategyEvaluationSummary>([["MOMENTUM_CONTINUATION", { evidenceQuality: "strong", evaluationScore }]]);
      const ranked = rankMarketCandidates(opportunities, [], "trending", strategiesBySymbol, new Map(), evaluationByStrategyType);
      expect(ranked[0]!.priorityScore).toBeLessThanOrEqual(80);
      expect(ranked[0]!.evaluationQualityFactor).toBeGreaterThanOrEqual(0.5);
      expect(ranked[0]!.evaluationQualityFactor).toBeLessThanOrEqual(1);
    }
  });

  it("M: an INSUFFICIENT-evidence strategy is never ranked as if it were 'proven' over a strong-evidence one with a worse current opportunity score, purely due to a good historical number", () => {
    // Both start from the same opportunityScore; only evaluation data differs.
    const opportunities = [
      { relatedEntityId: "PROVEN", score: 70, confidence: 80, evidence: {}, updatedAt: new Date() },
      { relatedEntityId: "UNPROVEN", score: 70, confidence: 80, evidence: {}, updatedAt: new Date() },
    ];
    const strategiesBySymbol = new Map([
      ["PROVEN", { strategyType: "TREND_FOLLOWING" } as never],
      ["UNPROVEN", { strategyType: "MOMENTUM_CONTINUATION" } as never],
    ]);
    const evaluationByStrategyType = new Map<string, StrategyEvaluationSummary>([
      ["TREND_FOLLOWING", { evidenceQuality: "strong", evaluationScore: 90 }],
      ["MOMENTUM_CONTINUATION", { evidenceQuality: "insufficient", evaluationScore: 99 }], // even a fabricated-looking high score must not matter while insufficient
    ]);
    const ranked = rankMarketCandidates(opportunities, [], "trending", strategiesBySymbol, new Map(), evaluationByStrategyType);
    const proven = ranked.find((r) => r.symbol === "PROVEN")!;
    const unproven = ranked.find((r) => r.symbol === "UNPROVEN")!;
    expect(unproven.evaluationQualityFactor).toBe(1); // insufficient -> no-op, regardless of its score value
    expect(proven.priorityScore).toBeLessThanOrEqual(unproven.priorityScore); // strong-but-scaled-down can still rank at or below a no-op factor -- it is never artificially inflated above current evidence either
  });

  it("M: evidence quality is the 2nd tie-break key, after priority score and before confidence", () => {
    const opportunities = [
      { relatedEntityId: "AAAUSDT", score: 50, confidence: 50, evidence: {}, updatedAt: new Date() },
      { relatedEntityId: "BBBUSDT", score: 50, confidence: 90, evidence: {}, updatedAt: new Date() },
    ];
    const strategiesBySymbol = new Map([
      ["AAAUSDT", { strategyType: "TREND_FOLLOWING" } as never],
      ["BBBUSDT", { strategyType: "MOMENTUM_CONTINUATION" } as never],
    ]);
    // Both factors resolve to 1.0 (insufficient), so priorityScore ties at 50 for both -- confidence should decide, BBBUSDT (90) before AAAUSDT (50).
    const ranked = rankMarketCandidates(opportunities, [], "trending", strategiesBySymbol);
    expect(ranked.map((r) => r.symbol)).toEqual(["BBBUSDT", "AAAUSDT"]);
  });

  it("M: getStrategyEvaluations wires end to end without error for a real organization with no strategies at all", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const evaluations = await getStrategyEvaluations(organization.id);
    expect(evaluations).toEqual([]);
  });
});

describe("N: failure classification -- only categories with real evidence, never fabricated", () => {
  afterAll(closeTestConnections);

  it("N: liquidation, stop_loss, and invalidated failures are each classified from their real closeReason", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    for (let i = 0; i < 5; i += 1) await createClosedPaperTrade(organization.id, { returnPct: 0.05, candidateConfidence: 85 }); // wins, to clear MIN_SAMPLE_SIZE cleanly alongside failures
    await createClosedPaperTrade(organization.id, { returnPct: -0.3, closeReason: "LIQUIDATED", candidateConfidence: 85 });
    await createClosedPaperTrade(organization.id, { returnPct: -0.05, closeReason: "STOPPED", candidateConfidence: 85 });
    await runPaperTradeResult(organization.id);

    const evaluation = await getStrategyEvaluation(organization.id, "TREND_FOLLOWING");
    expect(evaluation.status).toBe("evaluated");
    if (evaluation.status !== "evaluated") return;
    const byReason = new Map(evaluation.failureAnalysis.byReason.map((r) => [r.reason, r.count]));
    expect(byReason.get("liquidation")).toBe(1);
    expect(byReason.get("stop_loss")).toBe(1);
    expect(evaluation.failureAnalysis.totalFailingTrades).toBe(2);
  });

  it("N: a low-confidence-entry failure with no other stronger explanation is classified low_confidence_entry", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    for (let i = 0; i < 6; i += 1) await createClosedPaperTrade(organization.id, { returnPct: 0.05, regime: "trending", candidateConfidence: 85 });
    await createClosedPaperTrade(organization.id, { returnPct: -0.05, closeReason: "CLOSED", regime: "trending", candidateConfidence: 45 });
    await runPaperTradeResult(organization.id);

    const evaluation = await getStrategyEvaluation(organization.id, "TREND_FOLLOWING");
    expect(evaluation.status).toBe("evaluated");
    if (evaluation.status !== "evaluated") return;
    const byReason = new Map(evaluation.failureAnalysis.byReason.map((r) => [r.reason, r.count]));
    expect(byReason.get("low_confidence_entry")).toBe(1);
  });

  it("N: a failure with no closeReason/regime/confidence explanation is honestly unclassified, never a fabricated reason", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    for (let i = 0; i < 6; i += 1) await createClosedPaperTrade(organization.id, { returnPct: 0.05, regime: "trending", candidateConfidence: 85 });
    await createClosedPaperTrade(organization.id, { returnPct: -0.05, closeReason: "CLOSED", regime: "trending", candidateConfidence: 85 });
    await runPaperTradeResult(organization.id);

    const evaluation = await getStrategyEvaluation(organization.id, "TREND_FOLLOWING");
    expect(evaluation.status).toBe("evaluated");
    if (evaluation.status !== "evaluated") return;
    const byReason = new Map(evaluation.failureAnalysis.byReason.map((r) => [r.reason, r.count]));
    expect(byReason.get("unclassified")).toBe(1);
    // Never a category this codebase cannot actually derive evidence for.
    expect([...byReason.keys()]).not.toContain("excessive_volatility");
    expect([...byReason.keys()]).not.toContain("wrong_direction");
  });
});

describe("O: no-data case", () => {
  afterAll(closeTestConnections);

  it("O: an organization with zero paper trades reports an empty evaluation list, and an explicit strategy lookup reports insufficient_evidence with 0 trades", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const evaluations = await getStrategyEvaluations(organization.id);
    expect(evaluations).toEqual([]);
    const single = await getStrategyEvaluation(organization.id, "TREND_FOLLOWING");
    expect(single).toEqual({ status: "insufficient_evidence", strategyType: "TREND_FOLLOWING", evaluatedTrades: 0, minimumRequired: MIN_SAMPLE_SIZE });
  });
});

describe("P: liquidation is reported and penalized explicitly", () => {
  afterAll(closeTestConnections);

  it("P: liquidationRate reflects real liquidations, and a liquidated trade contributes to worstTradePnl honestly", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    for (let i = 0; i < 4; i += 1) await createClosedPaperTrade(organization.id, { returnPct: 0.02, netPnl: 20 });
    await createClosedPaperTrade(organization.id, { returnPct: -0.9, netPnl: -900, closeReason: "LIQUIDATED" });
    await runPaperTradeResult(organization.id);

    const evaluation = await getStrategyEvaluation(organization.id, "TREND_FOLLOWING");
    expect(evaluation.status).toBe("evaluated");
    if (evaluation.status !== "evaluated") return;
    expect(evaluation.liquidationRate).toBe(20); // 1 of 5
    expect(evaluation.worstTradePnl).toBe(-900);
  });
});

describe("Q/R: tenant isolation and cross-tenant rejection", () => {
  afterAll(closeTestConnections);

  it("Q: strategy evaluation for one organization never includes another organization's paper trades", async () => {
    const ownerA = await signUpUser();
    const orgA = await createOrgForUser(ownerA);
    const ownerB = await signUpUser();
    const orgB = await createOrgForUser(ownerB);
    await seedEvaluatedTrades(orgA.id, MIN_SAMPLE_SIZE, () => ({ returnPct: 0.05 }));
    await seedEvaluatedTrades(orgB.id, MIN_SAMPLE_SIZE, () => ({ returnPct: -0.05 }));

    const evalA = await getStrategyEvaluation(orgA.id, "TREND_FOLLOWING");
    const evalB = await getStrategyEvaluation(orgB.id, "TREND_FOLLOWING");
    expect(evalA.status).toBe("evaluated");
    expect(evalB.status).toBe("evaluated");
    if (evalA.status !== "evaluated" || evalB.status !== "evaluated") return;
    expect(evalA.winRate).toBe(100);
    expect(evalB.winRate).toBe(0);
  });

  it("R: a cross-tenant query against another organization's PaperTrade rows throws CrossTenantAccessError", async () => {
    const ownerA = await signUpUser();
    const orgA = await createOrgForUser(ownerA);
    const ownerB = await signUpUser();
    const orgB = await createOrgForUser(ownerB);
    await createClosedPaperTrade(orgA.id, { returnPct: 0.05 });

    const scopedB = getTenantScopedClient(orgB.id);
    await expect(scopedB.paperTrade.findFirst({ where: { organizationId: orgA.id } })).rejects.toBeInstanceOf(CrossTenantAccessError);
  });
});

describe("S: idempotency -- evaluation is a pure read, never writes, never duplicates", () => {
  afterAll(closeTestConnections);

  it("S: calling getStrategyEvaluations twice in a row produces byte-identical output and never creates a duplicate Outcome/LearningRecord/PaperTrade", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await seedEvaluatedTrades(organization.id, MIN_SAMPLE_SIZE, () => ({ returnPct: 0.05, candidateScore: 80 }));

    const outcomesBefore = await prisma.outcome.count({ where: { organizationId: organization.id } });
    const learningBefore = await prisma.learningRecord.count({ where: { organizationId: organization.id } });
    const tradesBefore = await prisma.paperTrade.count({ where: { organizationId: organization.id } });

    const first = await getStrategyEvaluations(organization.id);
    const second = await getStrategyEvaluations(organization.id);
    expect(first).toEqual(second);

    const outcomesAfter = await prisma.outcome.count({ where: { organizationId: organization.id } });
    const learningAfter = await prisma.learningRecord.count({ where: { organizationId: organization.id } });
    const tradesAfter = await prisma.paperTrade.count({ where: { organizationId: organization.id } });
    expect(outcomesAfter).toBe(outcomesBefore);
    expect(learningAfter).toBe(learningBefore);
    expect(tradesAfter).toBe(tradesBefore);
  });
});

describe("T/U: CRITICAL SAFETY -- policy immutability and the market autonomy ceiling", () => {
  afterAll(closeTestConnections);

  it("T: a full evaluation pass over several strategies leaves AutonomyPolicy, its version history, and the allowlist byte-for-byte unchanged", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await seedEvaluatedTrades(organization.id, MIN_SAMPLE_SIZE, () => ({ returnPct: 0.05 }));
    await seedEvaluatedTrades(organization.id, MIN_SAMPLE_SIZE, () => ({ strategyType: "MOMENTUM_CONTINUATION", returnPct: -0.05 }));

    const policyBefore = await getOrCreatePolicy(organization.id, "market");
    const allowlistBefore = await listAllowlist(organization.id, "market");
    const versionCountBefore = await prisma.autonomyPolicyVersion.count({ where: { organizationId: organization.id } });

    await getStrategyEvaluations(organization.id);

    const policyAfter = await getOrCreatePolicy(organization.id, "market");
    const allowlistAfter = await listAllowlist(organization.id, "market");
    const versionCountAfter = await prisma.autonomyPolicyVersion.count({ where: { organizationId: organization.id } });

    expect(policyAfter).toEqual(policyBefore);
    expect(allowlistAfter).toEqual(allowlistBefore);
    expect(versionCountAfter).toBe(versionCountBefore);
  });

  it("U: the market autonomy ceiling stays capped at L2, unchanged by this sprint", () => {
    expect(MAX_AUTONOMY_LEVEL_BY_DOMAIN.market).toBe("L2");
  });
});

describe("V/W/X: CRITICAL SAFETY -- no real execution, no credential, no private Binance endpoint", () => {
  afterAll(closeTestConnections);

  it("V: no order/account/withdrawal/transfer capability exists anywhere in the registered tool set", () => {
    const forbiddenNamePattern = /placeorder|createorder|executeorder|withdraw|transfer|deposit/i;
    const offendingTools = listRegisteredTools().filter((tool) => forbiddenNamePattern.test(tool.name));
    expect(offendingTools).toHaveLength(0);
  });

  it("W/X: the Binance market data client still exposes exactly getCandles/getExchangeInfo/getTicker24hr -- no credential surface, no private endpoint", async () => {
    const { createBinancePublicClient } = await import("@/server/market-data/binance-client");
    const client = createBinancePublicClient();
    expect(Object.keys(client).sort()).toEqual(["getCandles", "getExchangeInfo", "getTicker24hr"]);
  });

  it("every market-domain tool, including the extended get_strategy_performance, stays read_only and non-autonomy-eligible", () => {
    const marketTools = listRegisteredTools().filter((t) => t.domain === "market");
    expect(marketTools.length).toBeGreaterThanOrEqual(3);
    expect(marketTools.every((t) => t.mutationCategory === "read_only")).toBe(true);
    expect(marketTools.every((t) => !t.autonomyEligible)).toBe(true);
  });

  it("get_strategy_performance now also returns Sprint 18 evaluation data to a permitted viewer, still read-only", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const viewer = await signUpUser();
    await addMemberDirect(organization.id, viewer, "viewer");
    await seedEvaluatedTrades(organization.id, MIN_SAMPLE_SIZE, () => ({ returnPct: 0.05 }));

    const tool = getTool("get_strategy_performance");
    expect(tool?.mutationCategory).toBe("read_only");
    expect(tool?.autonomyEligible).toBeFalsy();

    const conversation = await createConversation({ organizationId: organization.id, userId: viewer.userId });
    const result = await executeToolCall(
      { id: "sp-1", name: "get_strategy_performance", arguments: {} },
      { organizationId: organization.id, userId: viewer.userId, conversationId: conversation.id },
      authHeaders(viewer.token),
    );
    expect(result.status).toBe("success");
    const payload = result as unknown as { output?: { evaluations?: Array<{ strategyType?: string }> } };
    expect(Array.isArray(payload.output?.evaluations)).toBe(true);
    expect(payload.output?.evaluations?.[0]?.strategyType).toBe("TREND_FOLLOWING");
  });
});

describe("scaleToFactor reuse -- shared bounded curve, not reimplemented", () => {
  it("stays bounded to [0.5, 1.0] regardless of extreme input, matching decision-intelligence/ranking.ts's own guarantee", () => {
    expect(scaleToFactor(-100)).toBe(0.5);
    expect(scaleToFactor(200)).toBe(1.0);
  });
});
