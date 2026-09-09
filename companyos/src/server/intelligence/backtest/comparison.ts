import { getStrategyTypePerformance } from "@/server/intelligence/strategy-performance/service";
import { getStrategyEvaluations } from "@/server/intelligence/strategy-evaluation/service";
import { getBacktestRun, listBacktestRuns, type BacktestRunSummary } from "@/server/intelligence/backtest/run-service";
import type { BacktestOutcomeMetrics, BacktestRobustnessBucket } from "@/server/intelligence/backtest/metrics";
import type { BacktestQualityScore } from "@/server/intelligence/backtest/quality-score";
import { MAX_COMPARISON_RUNS } from "@/server/intelligence/backtest/constants";

export type BacktestRunComparisonEntry = {
  id: string;
  label: string;
  status: BacktestRunSummary["status"];
  config: BacktestRunSummary["config"];
  metrics: BacktestOutcomeMetrics | null;
  qualityScore: BacktestQualityScore | null;
};

/**
 * Sprint 21 (multi-scenario/period comparison): reads up to
 * `MAX_COMPARISON_RUNS` already-completed `BacktestRun` rows this
 * organization owns and returns them side by side, each with its own
 * already-computed `metrics`/`qualityScore` (Sprint 20's own
 * `computeBacktestOutcomeMetrics`/`computeBacktestQualityScore` output,
 * never recomputed or blended into a single combined figure). A run that
 * isn't `COMPLETED` yet (or belongs to a different organization --
 * `getBacktestRun` is itself tenant-scoped) is returned with `metrics`/
 * `qualityScore` as `null`, never a fabricated placeholder.
 */
export async function compareBacktestRuns(organizationId: string, runIds: string[]): Promise<BacktestRunComparisonEntry[]> {
  const boundedIds = runIds.slice(0, MAX_COMPARISON_RUNS);
  const runs = await Promise.all(boundedIds.map((id) => getBacktestRun(organizationId, id)));

  return runs
    .filter((run): run is NonNullable<typeof run> => run !== null)
    .map((run) => ({
      id: run.id,
      label: run.label,
      status: run.status,
      config: run.config,
      metrics: run.status === "COMPLETED" && run.result ? run.result.metrics : null,
      qualityScore: run.status === "COMPLETED" && run.result ? run.result.qualityScore : null,
    }));
}

export type BacktestVsLiveMetricRow = {
  metric: string;
  backtestValue: number | string | null;
  liveValue: number | string | null;
};

export type BacktestVsLiveComparison =
  | { status: "backtest_not_found" }
  | { status: "strategy_type_not_in_backtest"; strategyType: string }
  | {
      status: "compared";
      strategyType: string;
      backtestRunId: string;
      backtestRunLabel: string;
      backtestEvidenceQuality: string;
      liveEvidenceQuality: string | null;
      rows: BacktestVsLiveMetricRow[];
    };

const round2 = (v: number): number => Math.round(v * 100) / 100;

/**
 * Sprint 21 (backtest vs. paper-trading comparability): takes ONE
 * completed `BacktestRun`'s own `robustness.byStrategyType` bucket for
 * `strategyType` (Sprint 20 -- computed entirely from THIS run's isolated,
 * in-memory simulated trades) and lays it side by side against the SAME
 * strategy type's REAL, live measurements: `getStrategyTypePerformance`
 * (Sprint 17, over real closed `PaperTrade` rows) and `getStrategyEvaluations`
 * (Sprint 18, the live evidence-quality/evaluation score). The two sides
 * are NEVER averaged, blended, or written back into each other -- this
 * function only ever returns two labeled columns for a human/AI reader to
 * compare, exactly matching the sprint's own "backtest ile paper-trading
 * sonuçlarını birbirine karıştırma" requirement. Live ranking
 * (`market-intelligence/ranking.ts`) is completely untouched by this
 * function -- it is read-only and one-directional (backtest/live data IN,
 * a comparison view OUT, nothing written anywhere).
 */
export async function compareBacktestToLive(organizationId: string, backtestRunId: string, strategyType: string): Promise<BacktestVsLiveComparison> {
  const run = await getBacktestRun(organizationId, backtestRunId);
  if (!run || run.status !== "COMPLETED" || !run.result) return { status: "backtest_not_found" };

  const backtestBucket: BacktestRobustnessBucket | undefined = run.result.robustness.byStrategyType.find((b) => b.key === strategyType);
  if (!backtestBucket) return { status: "strategy_type_not_in_backtest", strategyType };

  const [liveTypePerformance, liveEvaluations] = await Promise.all([getStrategyTypePerformance(organizationId), getStrategyEvaluations(organizationId)]);

  const live = liveTypePerformance.find((p) => p.strategyType === strategyType)?.performance ?? null;
  const liveEvaluation = liveEvaluations.find((e) => e.strategyType === strategyType) ?? null;
  const liveEvidenceQuality = liveEvaluation && liveEvaluation.status === "evaluated" ? liveEvaluation.evidenceQuality : liveEvaluation ? "insufficient" : null;

  const rows: BacktestVsLiveMetricRow[] = [
    { metric: "Sample size (evaluated trades)", backtestValue: backtestBucket.evaluatedTrades, liveValue: live?.evaluatedTrades ?? null },
    { metric: "Win rate (%)", backtestValue: backtestBucket.winRate, liveValue: live?.winRate ?? null },
    { metric: "Average return (%)", backtestValue: backtestBucket.averageReturnPct, liveValue: live?.averageReturnPct ?? null },
    { metric: "Total net P&L (simulated)", backtestValue: backtestBucket.totalNetPnl, liveValue: live?.totalRealizedPnl ?? null },
    {
      metric: "Risk-adjusted return (Sharpe-like)",
      backtestValue: run.result.metrics.riskAdjustedReturn.status === "computed" ? run.result.metrics.riskAdjustedReturn.value : null,
      liveValue: null, // live per-strategy-type risk-adjusted return is not currently surfaced by strategy-performance/service.ts -- never fabricated here
    },
    {
      metric: "Max drawdown (%)",
      backtestValue: run.result.metrics.maxDrawdown.status === "computed" ? run.result.metrics.maxDrawdown.maxDrawdownPct : null,
      liveValue: liveEvaluation && liveEvaluation.status === "evaluated" && liveEvaluation.maxDrawdown.status === "computed" ? liveEvaluation.maxDrawdown.maxDrawdownPct : null,
    },
  ];

  return {
    status: "compared",
    strategyType,
    backtestRunId: run.id,
    backtestRunLabel: run.label,
    backtestEvidenceQuality: backtestBucket.evidenceQuality,
    liveEvidenceQuality,
    rows: rows.map((r) => ({ ...r, backtestValue: typeof r.backtestValue === "number" ? round2(r.backtestValue) : r.backtestValue, liveValue: typeof r.liveValue === "number" ? round2(r.liveValue) : r.liveValue })),
  };
}

export type MostRecentBacktestComparison = {
  backtestRun: { id: string; label: string; createdAt: string } | null;
  comparisons: BacktestVsLiveComparison[];
};

/**
 * The read shape `get_strategy_performance` (Sprint 21) surfaces: this
 * organization's single most recently COMPLETED `BacktestRun`, and a
 * backtest-vs-live comparison for every strategy type that run's own
 * `robustness.byStrategyType` actually covers. Always "the most recent
 * completed run," never an ambiguous or caller-guessed choice -- if the
 * organization has never completed a run, `backtestRun` is `null` and
 * `comparisons` is empty, never fabricated.
 */
export async function getMostRecentBacktestComparisons(organizationId: string): Promise<MostRecentBacktestComparison> {
  const recentRuns = await listBacktestRuns(organizationId, MAX_COMPARISON_RUNS);
  const mostRecentCompleted = recentRuns.find((r) => r.status === "COMPLETED");
  if (!mostRecentCompleted) return { backtestRun: null, comparisons: [] };

  const full = await getBacktestRun(organizationId, mostRecentCompleted.id);
  if (!full || !full.result) return { backtestRun: null, comparisons: [] };

  const strategyTypes = full.result.robustness.byStrategyType.map((b) => b.key);
  const comparisons = await Promise.all(strategyTypes.map((strategyType) => compareBacktestToLive(organizationId, mostRecentCompleted.id, strategyType)));

  return {
    backtestRun: { id: mostRecentCompleted.id, label: mostRecentCompleted.label, createdAt: mostRecentCompleted.createdAt },
    comparisons,
  };
}
