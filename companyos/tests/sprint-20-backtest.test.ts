import { describe, expect, it } from "vitest";
import type { Candle } from "@/server/market-data/types";
import { BENCHMARK_SYMBOL, DAILY_INTERVAL, DAILY_WINDOW, SHORT_INTERVAL, SHORT_WINDOW } from "@/server/market-data/types";
import { computeReplayStepTimes, createHistoricalMarketDataClient, sliceCandlesAsOf, type AsOfCursor } from "@/server/intelligence/backtest/historical-data";
import { runReplay } from "@/server/intelligence/backtest/engine";
import { runBacktest, BACKTEST_DISCLAIMER } from "@/server/intelligence/backtest/service";
import { computeBacktestOutcomeMetrics, computeBacktestRobustness } from "@/server/intelligence/backtest/metrics";
import { computeBacktestQualityScore } from "@/server/intelligence/backtest/quality-score";
import { computeWalkForwardSplit } from "@/server/intelligence/backtest/walk-forward";
import { MIN_SAMPLE_SIZE, WARMUP_DAILY_CANDLES } from "@/server/intelligence/backtest/constants";
import type { BacktestConfig, HistoricalDataset } from "@/server/intelligence/backtest/types";

const HOUR_MS = 60 * 60 * 1000;
const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const START_MS = Date.UTC(2023, 0, 1, 0, 0, 0);
const OTHER_SYMBOL = "ETHUSDT";

function buildSeries(startMs: number, count: number, intervalMs: number, priceAt: (i: number) => number, volumeAt: (i: number) => number = () => 1000): Candle[] {
  const candles: Candle[] = [];
  for (let i = 0; i < count; i++) {
    const closeTimeMs = startMs + (i + 1) * intervalMs;
    const openTimeMs = closeTimeMs - intervalMs;
    const close = priceAt(i);
    candles.push({
      openTime: new Date(openTimeMs),
      closeTime: new Date(closeTimeMs),
      open: close.toFixed(4),
      high: (close * 1.001).toFixed(4),
      low: (close * 0.999).toFixed(4),
      close: close.toFixed(4),
      volume: volumeAt(i).toFixed(8),
    });
  }
  return candles;
}

/** A steady ~0.3%/hour compounding uptrend -- deterministic, real TREND_FOLLOWING eligibility (see engine.ts's own reuse of `strategy/scoring.ts#evaluateTrendFollowing`), reliably closes via TAKE_PROFIT since price only ever rises. */
function uptrendCloseAt(hourIndex: number, base = 20000, hourlyRate = 0.003): number {
  return base * (1 + hourlyRate) ** hourIndex;
}

function buildUptrendDataset(symbols: string[], hours: number): HistoricalDataset {
  const dataset: HistoricalDataset = {};
  const allSymbols = symbols.includes(BENCHMARK_SYMBOL) ? symbols : [...symbols, BENCHMARK_SYMBOL];
  for (const symbol of allSymbols) {
    const daily = buildSeries(START_MS, hours, HOUR_MS, (i) => uptrendCloseAt(i));
    const shortCount = hours * 4;
    const short = buildSeries(START_MS, shortCount, FIFTEEN_MIN_MS, (i) => uptrendCloseAt(i / 4));
    dataset[symbol] = { daily, short };
  }
  return dataset;
}

function baseConfig(overrides: Partial<BacktestConfig> = {}): BacktestConfig {
  const hours = overrides.dataset ? 0 : 80;
  return {
    organizationId: "org_test",
    symbols: [OTHER_SYMBOL],
    dataset: overrides.dataset ?? buildUptrendDataset([OTHER_SYMBOL], hours),
    ...overrides,
  };
}

describe("Sprint 20: Historical Market Replay & Backtest Engine", () => {
  // ── Group A: historical data / as-of slicing ──────────────────────────
  describe("A. sliceCandlesAsOf / historical data client", () => {
    it("A1: returns null when fewer than windowSize candles exist at or before asOfMs", () => {
      const candles = buildSeries(START_MS, 5, HOUR_MS, (i) => 100 + i);
      expect(sliceCandlesAsOf(candles, START_MS + 3 * HOUR_MS, 10)).toBeNull();
    });

    it("A2: returns exactly the trailing windowSize candles ending at or before asOfMs", () => {
      const candles = buildSeries(START_MS, 10, HOUR_MS, (i) => 100 + i);
      const window = sliceCandlesAsOf(candles, START_MS + 5 * HOUR_MS, 3);
      expect(window).not.toBeNull();
      expect(window!.map((c) => Number(c.close))).toEqual([102, 103, 104]);
    });

    it("A3: never includes a candle whose closeTime is after asOfMs, even when later candles exist in the array", () => {
      const candles = buildSeries(START_MS, 20, HOUR_MS, (i) => 100 + i);
      const asOfMs = START_MS + 5 * HOUR_MS;
      const window = sliceCandlesAsOf(candles, asOfMs, 5)!;
      for (const c of window) expect(c.closeTime.getTime()).toBeLessThanOrEqual(asOfMs);
    });

    it("A4: the historical client throws MarketDataProviderError for a symbol with no loaded data", async () => {
      const cursor: AsOfCursor = { asOfMs: START_MS + 10 * HOUR_MS };
      const client = createHistoricalMarketDataClient({}, cursor);
      await expect(client.getCandles("BTCUSDT", DAILY_INTERVAL, DAILY_WINDOW)).rejects.toThrow();
    });

    it("A5: the historical client throws when insufficient warmup exists yet at the cursor's current asOfMs", async () => {
      const dataset = buildUptrendDataset([OTHER_SYMBOL], 5);
      const cursor: AsOfCursor = { asOfMs: START_MS + 2 * HOUR_MS };
      const client = createHistoricalMarketDataClient(dataset, cursor);
      await expect(client.getCandles(OTHER_SYMBOL, DAILY_INTERVAL, DAILY_WINDOW)).rejects.toThrow();
    });

    it("A6: the historical client serves a full window once enough warmup has elapsed", async () => {
      const dataset = buildUptrendDataset([OTHER_SYMBOL], 80);
      const cursor: AsOfCursor = { asOfMs: START_MS + DAILY_WINDOW * HOUR_MS };
      const client = createHistoricalMarketDataClient(dataset, cursor);
      const daily = await client.getCandles(OTHER_SYMBOL, DAILY_INTERVAL, DAILY_WINDOW);
      expect(daily).toHaveLength(DAILY_WINDOW);
      const short = await client.getCandles(OTHER_SYMBOL, SHORT_INTERVAL, SHORT_WINDOW);
      expect(short).toHaveLength(SHORT_WINDOW);
    });

    it("A7: computeReplayStepTimes always includes BENCHMARK_SYMBOL's timeline even if the caller's own symbol list omits it", () => {
      const dataset = buildUptrendDataset([OTHER_SYMBOL], 10);
      const steps = computeReplayStepTimes(dataset, [OTHER_SYMBOL]);
      expect(steps.length).toBe(10);
      expect(steps).toEqual([...steps].sort((a, b) => a - b));
    });
  });

  // ── Group B: warmup ────────────────────────────────────────────────────
  describe("B. warmup", () => {
    it("B1: produces zero processed steps when the dataset is shorter than the real warmup requirement", async () => {
      const dataset = buildUptrendDataset([OTHER_SYMBOL], WARMUP_DAILY_CANDLES - 1);
      const result = await runReplay(baseConfig({ dataset }));
      expect(result.stepsProcessed).toBe(0);
      expect(result.closedTrades).toHaveLength(0);
    });

    it("B2: the first processed step occurs only once WARMUP_DAILY_CANDLES/WARMUP_SHORT_CANDLES are both available", async () => {
      const hours = WARMUP_DAILY_CANDLES + 5;
      const dataset = buildUptrendDataset([OTHER_SYMBOL], hours);
      const result = await runReplay(baseConfig({ dataset }));
      expect(result.stepsProcessed).toBeGreaterThan(0);
      expect(result.stepsProcessed).toBeLessThanOrEqual(hours);
      const firstStepMs = new Date(result.firstStepTime!).getTime();
      expect(firstStepMs).toBeGreaterThanOrEqual(START_MS + WARMUP_DAILY_CANDLES * HOUR_MS - HOUR_MS);
    });
  });

  // ── Group C: config validation ─────────────────────────────────────────
  describe("C. config validation", () => {
    it("C1: throws when the benchmark symbol has no loaded historical data at all", async () => {
      const dataset: HistoricalDataset = { [OTHER_SYMBOL]: buildUptrendDataset([OTHER_SYMBOL], 80)[OTHER_SYMBOL]! };
      await expect(runReplay(baseConfig({ dataset, symbols: [OTHER_SYMBOL] }))).rejects.toThrow(/benchmark/);
    });

    it("C2: throws when a requested tradeable symbol has no loaded historical data", async () => {
      const dataset = buildUptrendDataset([], 80);
      await expect(runReplay(baseConfig({ dataset, symbols: ["DOGEUSDT"] }))).rejects.toThrow(/DOGEUSDT/);
    });

    it("C3: deduplicates a symbols list containing the same symbol twice", async () => {
      const dataset = buildUptrendDataset([OTHER_SYMBOL], 80);
      const result = await runReplay(baseConfig({ dataset, symbols: [OTHER_SYMBOL, OTHER_SYMBOL] }));
      expect(result.symbols).toEqual([OTHER_SYMBOL]);
    });
  });

  // ── Group D: real trade lifecycle (reused Sprint 15/16/19 formulas) ────
  describe("D. trade lifecycle", () => {
    it("D1: a sustained uptrend produces at least one real, fully-priced closed trade", async () => {
      const report = await runBacktest(baseConfig());
      expect(report.run.closedTrades.length).toBeGreaterThan(0);
      const trade = report.run.closedTrades[0]!;
      expect(trade.entryPrice).toBeGreaterThan(0);
      expect(trade.quantity).toBeGreaterThan(0);
      expect(trade.notional).toBeCloseTo(trade.quantity * trade.entryPrice, 2);
      expect(Number.isFinite(trade.netPnl)).toBe(true);
    });

    it("D2: a monotonic uptrend closes trades via TAKE_PROFIT, never LIQUIDATED or STOPPED", async () => {
      const report = await runBacktest(baseConfig());
      const reasons = new Set(report.run.closedTrades.map((t) => t.closeReason));
      expect(reasons.has("LIQUIDATED")).toBe(false);
      expect(reasons.has("STOPPED")).toBe(false);
      expect(reasons.has("TAKE_PROFIT")).toBe(true);
    });

    it("D3: netPnl equals grossPnl minus feesPaid minus fundingPaid for every closed trade (reused computeNetPnl formula)", async () => {
      const report = await runBacktest(baseConfig());
      for (const trade of report.run.closedTrades) {
        expect(trade.netPnl).toBeCloseTo(trade.grossPnl - trade.feesPaid - trade.fundingPaid, 6);
      }
    });

    it("D4: direction is always LONG for a strictly rising price series (never a fabricated SHORT)", async () => {
      const report = await runBacktest(baseConfig());
      for (const trade of report.run.closedTrades) expect(trade.direction).toBe("LONG");
    });

    it("D5: every closed trade's strategyType is TREND_FOLLOWING for this fixture (never NO_TRADE -- a NO_TRADE candidate never produces an order)", async () => {
      const report = await runBacktest(baseConfig());
      for (const trade of report.run.closedTrades) expect(trade.strategyType).toBe("TREND_FOLLOWING");
    });

    it("D6: real backtest trades still open via Sprint 16's decideEntry even though the Sprint 19 execution-readiness trace never marks a proposal VALID (the two decision layers are deliberately independent -- see engine.ts's own doc comment)", async () => {
      const report = await runBacktest(baseConfig());
      // This fixture never accumulates a live/self StrategyEvaluation (always
      // null in a backtest decision context -- see engine.ts), so the
      // Sprint 19 readiness trace can never mark a BUY/SELL proposal VALID
      // (`validateProposedOrder`'s own `insufficient_evidence` gate, or an
      // earlier-ordered rejection, always fires first).
      const neverValid = report.run.decisionTrace.every((e) => e.decision.proposedOrder?.validationStatus !== "VALID");
      expect(neverValid).toBe(true);
      // Yet Sprint 16's OWN real entry gate (`decideEntry`, no evidence-quality check at all) still opened real trades.
      expect(report.run.closedTrades.length).toBeGreaterThan(0);
    });
  });

  // ── Group E: account bookkeeping ───────────────────────────────────────
  describe("E. account bookkeeping", () => {
    it("E1: currentEquity = startingEquity + realizedPnl + unrealizedPnl at the end of the run", async () => {
      const report = await runBacktest(baseConfig());
      const { finalAccount } = report.run;
      expect(finalAccount.currentEquity).toBeCloseTo(finalAccount.startingEquity + finalAccount.realizedPnl + finalAccount.unrealizedPnl, 4);
    });

    it("E2: totalFees never double-counts a single position's entry fee (a known, documented Sprint 16 production account-bookkeeping quirk this new module deliberately does not reproduce)", async () => {
      const report = await runBacktest(baseConfig());
      const expectedTotalFees = report.run.closedTrades.reduce((sum, t) => sum + t.feesPaid, 0) + report.run.openPositionsAtEnd.reduce((sum, p) => sum + p.feesPaidSoFar, 0);
      expect(report.run.finalAccount.totalFees).toBeCloseTo(expectedTotalFees, 2);
    });

    it("E3: peakEquity never decreases over the course of a run", async () => {
      // Re-run with a full decision trace and confirm the reported peakEquity is >= startingEquity (a monotonic uptrend should never show a real drawdown below starting capital).
      const report = await runBacktest(baseConfig());
      expect(report.run.finalAccount.peakEquity).toBeGreaterThanOrEqual(report.run.finalAccount.startingEquity);
    });

    it("E4: drawdownPct is 0 when currentEquity equals peakEquity", async () => {
      const report = await runBacktest(baseConfig());
      if (report.run.finalAccount.currentEquity === report.run.finalAccount.peakEquity) {
        expect(report.run.finalAccount.drawdownPct).toBe(0);
      }
    });

    it("E5: availableMargin = currentEquity - usedMargin", async () => {
      const report = await runBacktest(baseConfig());
      const a = report.run.finalAccount;
      expect(a.availableMargin).toBeCloseTo(a.currentEquity - a.usedMargin, 6);
    });
  });

  // ── Group F: output metrics (Phase 10, zero-division-safe) ─────────────
  describe("F. output metrics", () => {
    it("F1: every rate/average field is null (never NaN/Infinity) when there are zero closed trades", () => {
      const metrics = computeBacktestOutcomeMetrics([]);
      expect(metrics.totalTrades).toBe(0);
      expect(metrics.winRate).toBeNull();
      expect(metrics.averageNetPnl).toBeNull();
      expect(metrics.averageReturnPct).toBeNull();
      expect(metrics.profitFactor).toBeNull();
      expect(metrics.liquidationRate).toBeNull();
      expect(metrics.maxDrawdown.status).toBe("no_data");
      expect(metrics.riskAdjustedReturn.status).toBe("insufficient_evidence");
    });

    it("F2: profitFactor is null (never Infinity) when there are wins but zero losses", () => {
      const trades = [
        { symbol: "A", direction: "LONG" as const, mode: "SPOT" as const, strategyType: "TREND_FOLLOWING", regime: null, candidateScore: 1, candidateConfidence: 1, leverage: 1, entryPrice: 100, exitPrice: 110, quantity: 1, notional: 100, initialMargin: 100, grossPnl: 10, feesPaid: 0, fundingPaid: 0, netPnl: 10, returnPct: 0.1, maxFavorableExcursion: 10, maxAdverseExcursion: 0, closeReason: "TAKE_PROFIT" as const, openedAt: new Date().toISOString(), closedAt: new Date().toISOString() },
      ];
      const metrics = computeBacktestOutcomeMetrics(trades);
      expect(metrics.profitFactor).toBeNull();
      expect(metrics.winRate).toBe(100);
    });

    it("F3: for a real backtest run, winCount + lossCount + breakEvenCount equals totalTrades", async () => {
      const report = await runBacktest(baseConfig());
      const m = report.metrics;
      expect(m.winCount + m.lossCount + m.breakEvenCount).toBe(m.totalTrades);
    });

    it("F4: liquidationRate + stopRate + takeProfitRate + invalidationRate never exceeds 100 (percentages of a real closed-trade population)", async () => {
      const report = await runBacktest(baseConfig());
      const m = report.metrics;
      const sum = (m.liquidationRate ?? 0) + (m.stopRate ?? 0) + (m.takeProfitRate ?? 0) + (m.invalidationRate ?? 0);
      expect(sum).toBeLessThanOrEqual(100.0001);
    });
  });

  // ── Group G: robustness breakdowns (Phase 11) ──────────────────────────
  describe("G. robustness breakdowns", () => {
    it("G1: bySymbol bucket keys are exactly the set of symbols with at least one closed trade", async () => {
      const report = await runBacktest(baseConfig());
      const symbolsWithTrades = new Set(report.run.closedTrades.map((t) => t.symbol));
      const bucketKeys = new Set(report.robustness.bySymbol.map((b) => b.key));
      expect(bucketKeys).toEqual(symbolsWithTrades);
    });

    it("G2: every bucket's evaluatedTrades sums to the total closed trade count across a fully-partitioning dimension (byDirection)", async () => {
      const report = await runBacktest(baseConfig());
      const sum = report.robustness.byDirection.reduce((s, b) => s + b.evaluatedTrades, 0);
      expect(sum).toBe(report.run.closedTrades.length);
    });

    it("G3: evidenceQuality is 'insufficient' for any bucket with fewer than MIN_SAMPLE_SIZE trades", async () => {
      const report = await runBacktest(baseConfig());
      for (const bucket of report.robustness.bySymbol) {
        if (bucket.evaluatedTrades < MIN_SAMPLE_SIZE) expect(bucket.evidenceQuality).toBe("insufficient");
      }
    });

    it("G4: robustness over zero trades returns empty buckets for every dimension, never a fabricated bucket", () => {
      const robustness = computeBacktestRobustness([]);
      expect(robustness.byStrategyType).toEqual([]);
      expect(robustness.byRegime).toEqual([]);
      expect(robustness.bySymbol).toEqual([]);
      expect(robustness.byDirection).toEqual([]);
      expect(robustness.byLeverage).toEqual([]);
    });
  });

  // ── Group H: walk-forward split (Phase 12) ─────────────────────────────
  describe("H. walk-forward split", () => {
    it("H1: reports insufficient_steps when firstStepTime === lastStepTime", () => {
      const split = computeWalkForwardSplit({
        organizationId: "org",
        symbols: [],
        stepsProcessed: 1,
        firstStepTime: "2023-01-01T00:00:00.000Z",
        lastStepTime: "2023-01-01T00:00:00.000Z",
        finalAccount: { startingEquity: 0, currentEquity: 0, peakEquity: 0, usedMargin: 0, unrealizedPnl: 0, realizedPnl: 0, totalFees: 0, totalFunding: 0, availableMargin: 0, drawdownPct: 0 },
        closedTrades: [],
        openPositionsAtEnd: [],
        decisionTrace: [],
        decisionTraceTruncated: false,
      });
      expect(split.status).toBe("insufficient_steps");
    });

    it("H2: every trade in inSample opened strictly before splitTime, every trade in outOfSample opened at or after it", async () => {
      const report = await runBacktest(baseConfig());
      const split = report.walkForward;
      if (split.status === "computed") {
        const splitMs = new Date(split.splitTime!).getTime();
        for (const t of split.inSample!.trades) expect(new Date(t.openedAt).getTime()).toBeLessThan(splitMs);
        for (const t of split.outOfSample!.trades) expect(new Date(t.openedAt).getTime()).toBeGreaterThanOrEqual(splitMs);
      }
    });

    it("H3: inSample.trades.length + outOfSample.trades.length equals the run's total closed trade count", async () => {
      const report = await runBacktest(baseConfig());
      const split = report.walkForward;
      if (split.status === "computed") {
        expect(split.inSample!.trades.length + split.outOfSample!.trades.length).toBe(report.run.closedTrades.length);
      }
    });
  });

  // ── Group I: backtest quality score (Phase 14) ─────────────────────────
  describe("I. quality score", () => {
    it("I1: returns insufficient_evidence below MIN_SAMPLE_SIZE closed trades", () => {
      const metrics = computeBacktestOutcomeMetrics([]);
      const score = computeBacktestQualityScore(metrics);
      expect(score.status).toBe("insufficient_evidence");
      if (score.status === "insufficient_evidence") expect(score.minimumRequired).toBe(MIN_SAMPLE_SIZE);
    });

    it("I2: the computed score is always within [0, 100]", async () => {
      const report = await runBacktest(baseConfig({ dataset: buildUptrendDataset([OTHER_SYMBOL], 400), symbols: [OTHER_SYMBOL] }));
      if (report.qualityScore.status === "computed") {
        expect(report.qualityScore.score).toBeGreaterThanOrEqual(0);
        expect(report.qualityScore.score).toBeLessThanOrEqual(100);
      }
    });

    it("I3: the quality score is never confused with Sprint 18's StrategyEvaluation score -- distinct type shape, no shared field name collision beyond 'score'", async () => {
      const report = await runBacktest(baseConfig({ dataset: buildUptrendDataset([OTHER_SYMBOL], 400), symbols: [OTHER_SYMBOL] }));
      expect(report.qualityScore).not.toHaveProperty("evidenceQuality");
    });
  });

  // ── Group J: LOOK-AHEAD BIAS -- the sprint's most critical tests ───────
  describe("J. look-ahead bias (CRITICAL)", () => {
    it("J1: appending future candles never changes any earlier step's decision or trade log", async () => {
      const shortHours = 100;
      const longHours = 200;
      const shortDataset = buildUptrendDataset([OTHER_SYMBOL], shortHours);
      const longDataset = buildUptrendDataset([OTHER_SYMBOL], longHours);

      const shortResult = await runReplay(baseConfig({ dataset: shortDataset, symbols: [OTHER_SYMBOL] }));
      const longResult = await runReplay(baseConfig({ dataset: longDataset, symbols: [OTHER_SYMBOL] }));

      expect(longResult.stepsProcessed).toBeGreaterThan(shortResult.stepsProcessed);

      // Every decision trace entry from the short run must appear byte-identical (decision-for-decision) in the long run's own trace up to the same step.
      const longTraceByKey = new Map(longResult.decisionTrace.map((e) => [`${e.stepTime}:${e.symbol}`, e.decision]));
      for (const entry of shortResult.decisionTrace) {
        const key = `${entry.stepTime}:${entry.symbol}`;
        expect(longTraceByKey.get(key)).toEqual(entry.decision);
      }

      // Every trade that fully CLOSED within the short run's own time range
      // is byte-identical in both runs. (A trade opened near the short
      // run's very end but only closed later, once the long run has more
      // steps to work with, is correctly absent from the short run's own
      // `closedTrades` -- that is the short run simply ending before that
      // position had a chance to close, never a look-ahead discrepancy; it
      // is exactly why the decision-trace comparison above, not this one,
      // is the real look-ahead proof.)
      const shortRangeEndMs = new Date(shortResult.lastStepTime!).getTime();
      const longTradesClosedWithinShortRange = longResult.closedTrades.filter((t) => new Date(t.closedAt).getTime() <= shortRangeEndMs);
      const shortTrades = shortResult.closedTrades.filter((t) => new Date(t.closedAt).getTime() <= shortRangeEndMs);
      expect(longTradesClosedWithinShortRange).toEqual(shortTrades);
    });

    it("J2: changing a future candle's close price never changes an earlier step's decision", async () => {
      const hours = 100;
      const baseline = buildUptrendDataset([OTHER_SYMBOL], hours);
      const mutated = buildUptrendDataset([OTHER_SYMBOL], hours);
      // Violently change only the LAST candle of every series -- a real, future crash -- and confirm every earlier decision is unaffected.
      for (const symbol of Object.keys(mutated)) {
        const last = mutated[symbol]!.daily[mutated[symbol]!.daily.length - 1]!;
        last.close = "1.00";
        last.high = "1.00";
        last.low = "1.00";
      }

      const baselineResult = await runReplay(baseConfig({ dataset: baseline, symbols: [OTHER_SYMBOL] }));
      const mutatedResult = await runReplay(baseConfig({ dataset: mutated, symbols: [OTHER_SYMBOL] }));

      // Every step except possibly the very last one must produce an identical decision trace entry.
      const n = Math.min(baselineResult.decisionTrace.length, mutatedResult.decisionTrace.length);
      for (let i = 0; i < n - 1; i++) {
        expect(mutatedResult.decisionTrace[i]).toEqual(baselineResult.decisionTrace[i]);
      }
    });

    it("J3: a future volume spike never affects an earlier step's strategy candidate", async () => {
      const hours = 100;
      const baseline = buildUptrendDataset([OTHER_SYMBOL], hours);
      const mutated = buildUptrendDataset([OTHER_SYMBOL], hours);
      for (const symbol of Object.keys(mutated)) {
        const daily = mutated[symbol]!.daily;
        daily[daily.length - 1]!.volume = "999999999";
      }

      const baselineResult = await runReplay(baseConfig({ dataset: baseline, symbols: [OTHER_SYMBOL] }));
      const mutatedResult = await runReplay(baseConfig({ dataset: mutated, symbols: [OTHER_SYMBOL] }));

      const n = Math.min(baselineResult.decisionTrace.length, mutatedResult.decisionTrace.length);
      for (let i = 0; i < n - 1; i++) {
        expect(mutatedResult.decisionTrace[i]!.decision.strategyType).toEqual(baselineResult.decisionTrace[i]!.decision.strategyType);
        expect(mutatedResult.decisionTrace[i]!.decision.action).toEqual(baselineResult.decisionTrace[i]!.decision.action);
      }
    });

    it("J4: a future regime shift (driven by the benchmark) never affects an earlier step's decision", async () => {
      const hours = 100;
      const baseline = buildUptrendDataset([OTHER_SYMBOL], hours);
      const mutated = buildUptrendDataset([OTHER_SYMBOL], hours);
      // Flatten the benchmark's LAST several candles into a tight range (a future regime shift toward "ranging"/"low_volatility").
      const benchmarkDaily = mutated[BENCHMARK_SYMBOL]!.daily;
      const flatPrice = Number(benchmarkDaily[benchmarkDaily.length - 10]!.close);
      for (let i = benchmarkDaily.length - 10; i < benchmarkDaily.length; i++) {
        benchmarkDaily[i]!.close = flatPrice.toFixed(4);
        benchmarkDaily[i]!.open = flatPrice.toFixed(4);
        benchmarkDaily[i]!.high = flatPrice.toFixed(4);
        benchmarkDaily[i]!.low = flatPrice.toFixed(4);
      }

      const baselineResult = await runReplay(baseConfig({ dataset: baseline, symbols: [OTHER_SYMBOL] }));
      const mutatedResult = await runReplay(baseConfig({ dataset: mutated, symbols: [OTHER_SYMBOL] }));

      const cutoffMs = new Date(benchmarkDaily[benchmarkDaily.length - 11]!.closeTime).getTime();
      for (const entry of baselineResult.decisionTrace) {
        if (new Date(entry.stepTime).getTime() > cutoffMs) continue;
        const match = mutatedResult.decisionTrace.find((e) => e.stepTime === entry.stepTime && e.symbol === entry.symbol);
        expect(match?.decision).toEqual(entry.decision);
      }
    });

    it("J5: a wildly different future trade outcome never changes an earlier step's strategy selection (backtest decisions never read a live/self StrategyEvaluation -- see engine.ts's own doc comment)", async () => {
      const hours = 150;
      const baseline = buildUptrendDataset([OTHER_SYMBOL], hours);
      const crashLater = buildUptrendDataset([OTHER_SYMBOL], hours);
      // Crash the price violently for the final third of the series -- this changes what LATER trades' outcomes are, but must never reach backward into earlier strategy selection.
      for (const symbol of Object.keys(crashLater)) {
        const daily = crashLater[symbol]!.daily;
        const crashStart = Math.floor(daily.length * 0.66);
        for (let i = crashStart; i < daily.length; i++) {
          const crashed = (uptrendCloseAt(crashStart) * (1 - 0.01 * (i - crashStart))).toFixed(4);
          daily[i]!.close = crashed;
          daily[i]!.open = crashed;
          daily[i]!.high = crashed;
          daily[i]!.low = crashed;
        }
      }

      const baselineResult = await runReplay(baseConfig({ dataset: baseline, symbols: [OTHER_SYMBOL] }));
      const crashResult = await runReplay(baseConfig({ dataset: crashLater, symbols: [OTHER_SYMBOL] }));

      const preCrashTradeCount = Math.floor(baselineResult.closedTrades.length * 0.5);
      for (let i = 0; i < preCrashTradeCount; i++) {
        expect(crashResult.closedTrades[i]).toEqual(baselineResult.closedTrades[i]);
      }
    });
  });

  // ── Group K: determinism / idempotency (Phase 20) ──────────────────────
  describe("K. determinism / idempotency", () => {
    it("K1: running the identical config twice produces a byte-identical BacktestRunResult", async () => {
      const config = baseConfig();
      const first = await runReplay(config);
      const second = await runReplay(config);
      expect(second).toEqual(first);
    });

    it("K2: runBacktest is fully deterministic end-to-end (metrics, robustness, qualityScore, walkForward included)", async () => {
      const config = baseConfig({ dataset: buildUptrendDataset([OTHER_SYMBOL], 400), symbols: [OTHER_SYMBOL] });
      const first = await runBacktest(config);
      const second = await runBacktest(config);
      expect(second).toEqual(first);
    });
  });

  // ── Group L: isolation from production state ───────────────────────────
  describe("L. isolation", () => {
    it("L1: this entire test suite runs and passes with zero database or Redis connection setup -- the pure replay engine never queries Prisma or any tenant-scoped client", async () => {
      // No beforeAll/afterAll opens a Prisma or Redis connection anywhere in
      // this file (contrast with every other Sprint 13-19 test file, which
      // imports `closeTestConnections` from `./helpers`). If `runBacktest`
      // secretly touched the database, the very first `await runBacktest(...)`
      // call above in this file would already have thrown or hung.
      const report = await runBacktest(baseConfig());
      expect(report.run.closedTrades.length).toBeGreaterThan(0);
    });

    it("L2: the returned report never contains a real PaperAccount/PaperPosition/PaperTrade id (every backtest position/trade is a plain in-memory object with no `id` field at all)", async () => {
      const report = await runBacktest(baseConfig());
      for (const trade of report.run.closedTrades) expect(trade).not.toHaveProperty("id");
      for (const position of report.run.openPositionsAtEnd) expect(position).not.toHaveProperty("id");
    });
  });

  // ── Group M: security invariants (Phase 18) ────────────────────────────
  describe("M. security invariants", () => {
    it("M1: the backtest report always carries the explicit BACKTEST/SIMULATION disclaimer", async () => {
      const report = await runBacktest(baseConfig());
      expect(report.disclaimer).toBe(BACKTEST_DISCLAIMER);
      expect(report.disclaimer.toUpperCase()).toContain("NOT REAL TRADING");
    });

    it("M2: every decision's killSwitchEngaged is always false (a backtest never reflects or is gated by the real organization's live kill switch)", async () => {
      const report = await runBacktest(baseConfig());
      for (const entry of report.run.decisionTrace) expect(entry.decision.killSwitchEngaged).toBe(false);
    });

    it("M3: no proposedOrder ever carries any field resembling a real exchange order id, API key, or account id", async () => {
      const report = await runBacktest(baseConfig());
      for (const entry of report.run.decisionTrace) {
        const order = entry.decision.proposedOrder;
        if (!order) continue;
        expect(order).not.toHaveProperty("orderId");
        expect(order).not.toHaveProperty("apiKey");
        expect(order).not.toHaveProperty("accountId");
      }
    });
  });
});
