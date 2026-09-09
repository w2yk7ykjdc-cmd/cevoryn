import { WALK_FORWARD_TRAIN_RATIO } from "@/server/intelligence/backtest/constants";
import { computeBacktestOutcomeMetrics, type BacktestOutcomeMetrics } from "@/server/intelligence/backtest/metrics";
import type { BacktestRunResult, BacktestTrade } from "@/server/intelligence/backtest/types";

export type WalkForwardSplit = {
  status: "insufficient_steps" | "computed";
  splitTime: string | null;
  inSample: { trades: BacktestTrade[]; metrics: BacktestOutcomeMetrics } | null;
  outOfSample: { trades: BacktestTrade[]; metrics: BacktestOutcomeMetrics } | null;
};

/**
 * Sprint 20 Phase 12: a simple, honest, non-optimized chronological
 * train/test split -- computed AFTER the fact from a single completed
 * `runReplay` result, by partitioning its own `closedTrades` on `openedAt`
 * against a fixed time cutoff (`WALK_FORWARD_TRAIN_RATIO` of the way
 * through the replayed step range). This is deliberately NOT two separate
 * replay runs: `runReplay` is already structurally look-ahead-safe at
 * every single step (Phase 3/21 -- a decision at step T can never see step
 * T+1's data, regardless of when T falls relative to any later split
 * point), so partitioning its already-computed trade log by time is
 * exactly equivalent to running the "out-of-sample" window as its own
 * independent replay, without the cost, complexity, or risk of subtly
 * diverging behavior between two separately-run engines. Every
 * out-of-sample trade in the result was decided using ONLY information
 * available as of its own `openedAt` time -- never influenced by anything
 * that happened later, in-sample or out-of-sample alike.
 */
export function computeWalkForwardSplit(result: BacktestRunResult): WalkForwardSplit {
  if (!result.firstStepTime || !result.lastStepTime) {
    return { status: "insufficient_steps", splitTime: null, inSample: null, outOfSample: null };
  }

  const firstMs = new Date(result.firstStepTime).getTime();
  const lastMs = new Date(result.lastStepTime).getTime();
  if (firstMs === lastMs) {
    return { status: "insufficient_steps", splitTime: null, inSample: null, outOfSample: null };
  }

  const splitMs = firstMs + (lastMs - firstMs) * WALK_FORWARD_TRAIN_RATIO;
  const splitTime = new Date(splitMs).toISOString();

  const inSampleTrades = result.closedTrades.filter((t) => new Date(t.openedAt).getTime() < splitMs);
  const outOfSampleTrades = result.closedTrades.filter((t) => new Date(t.openedAt).getTime() >= splitMs);

  return {
    status: "computed",
    splitTime,
    inSample: { trades: inSampleTrades, metrics: computeBacktestOutcomeMetrics(inSampleTrades) },
    outOfSample: { trades: outOfSampleTrades, metrics: computeBacktestOutcomeMetrics(outOfSampleTrades) },
  };
}
