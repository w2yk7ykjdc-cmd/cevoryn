import { runReplay } from "@/server/intelligence/backtest/engine";
import { computeBacktestOutcomeMetrics, computeBacktestRobustness, type BacktestOutcomeMetrics, type BacktestRobustness } from "@/server/intelligence/backtest/metrics";
import { computeBacktestQualityScore, type BacktestQualityScore } from "@/server/intelligence/backtest/quality-score";
import { computeWalkForwardSplit, type WalkForwardSplit } from "@/server/intelligence/backtest/walk-forward";
import type { BacktestConfig, BacktestRunResult } from "@/server/intelligence/backtest/types";

/**
 * Every field in this report describes a HISTORICAL SIMULATION, computed
 * entirely from real past market data replayed through the real Sprint
 * 13-19 deterministic pipeline logic against an isolated, in-memory paper
 * account. It is NEVER real trading, NEVER a prediction of future
 * performance, and NEVER written to any real `PaperAccount`/`PaperPosition`/
 * `PaperTrade`/`CompanySignal`/`Opportunity`/`Risk` row. Every UI surface
 * that renders this MUST carry the same explicit BACKTEST / HISTORICAL
 * SIMULATION / NOT REAL TRADING labeling (Phase 15) -- this constant is the
 * single source of truth for that wording, so the disclaimer can never
 * drift between the API and the UI.
 */
export const BACKTEST_DISCLAIMER =
  "BACKTEST / HISTORICAL SIMULATION -- NOT REAL TRADING. Computed entirely from past market data against an isolated, in-memory paper account. Past performance in a simulation is not a guarantee, promise, or prediction of any future or live result.";

export type BacktestReport = {
  disclaimer: string;
  run: BacktestRunResult;
  metrics: BacktestOutcomeMetrics;
  robustness: BacktestRobustness;
  qualityScore: BacktestQualityScore;
  walkForward: WalkForwardSplit;
};

/**
 * The single public entry point for Sprint 20 (Phase 2-14 tied together):
 * runs the deterministic replay (`runReplay`), then derives every reported
 * figure purely from that one run's own `BacktestRunResult` -- output
 * metrics (Phase 10), robustness breakdowns (Phase 11), the optional
 * quality score (Phase 14), and a walk-forward split (Phase 12). Calling
 * this twice with the identical `config` always returns byte-identical
 * results (Phase 20) -- there is no randomness, no wall-clock read, and no
 * database read/write anywhere in this call graph.
 */
export async function runBacktest(config: BacktestConfig): Promise<BacktestReport> {
  const run = await runReplay(config);
  const metrics = computeBacktestOutcomeMetrics(run.closedTrades);
  const robustness = computeBacktestRobustness(run.closedTrades);
  const qualityScore = computeBacktestQualityScore(metrics);
  const walkForward = computeWalkForwardSplit(run);

  return { disclaimer: BACKTEST_DISCLAIMER, run, metrics, robustness, qualityScore, walkForward };
}
