import type { BacktestOutcomeMetrics } from "@/server/intelligence/backtest/metrics";
import { MIN_SAMPLE_SIZE } from "@/server/intelligence/backtest/constants";

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const clampScore = (x: number): number => Math.max(0, Math.min(100, Math.round(x)));

const WIN_RATE_COMPONENT_MAX = 35;
const RISK_ADJUSTED_COMPONENT_MAX = 35;
/** `computeRiskAdjustedReturn`'s own documented bound (`strategy-evaluation/service.ts#MAX_RISK_ADJUSTED_MAGNITUDE`) -- restated here by reference, not redefined, so the [0, `RISK_ADJUSTED_COMPONENT_MAX`] mapping always spans the true possible range. */
const RISK_ADJUSTED_MAGNITUDE_BOUND = 3;
const DRAWDOWN_PENALTY_MAX = 20;
const PROFIT_FACTOR_COMPONENT_MAX = 10;
const PROFIT_FACTOR_REFERENCE = 2;

export type BacktestQualityScoreBreakdown = {
  winRateComponent: number;
  riskAdjustedReturnComponent: number;
  profitFactorComponent: number;
  drawdownPenalty: number;
};

export type BacktestQualityScore =
  | { status: "insufficient_evidence"; closedTrades: number; minimumRequired: number }
  | { status: "computed"; score: number; breakdown: BacktestQualityScoreBreakdown };

/**
 * Sprint 20 Phase 14 (optional): a deterministic, bounded [0,100]
 * "Backtest Quality/Robustness Score" -- named and scoped distinctly from
 * Sprint 18's `StrategyEvaluation.evaluationScore` (a LIVE/paper-trading
 * measure) so the two are never confused or averaged together; this one
 * describes only "how strong is the evidence THIS BACKTEST RUN produced,"
 * never a claim about how the strategy performs live. Reuses the exact
 * same `MIN_SAMPLE_SIZE` evidence gate every other score in this codebase
 * already uses (Sprint 12/17/18) -- `insufficient_evidence` below it, no
 * score, no label, exactly like `StrategyEvaluation` itself.
 *
 * Transparent, additive, independently-capped contributions (the same
 * "never a weighted average nobody can explain" discipline
 * `computeOpportunityScore`/`computeStrategyScore`/`computeEvaluationScore`
 * already established):
 * - win rate (up to 35): the most basic, literal measure of this run's
 *   own outcome distribution.
 * - risk-adjusted return (up to 35): reuses `computeRiskAdjustedReturn`
 *   verbatim, mapped from its own documented [-3, 3] bound onto [0, 35].
 * - profit factor (up to 10): reuses this run's own `profitFactor`,
 *   scaled against a documented 2.0 reference (a commonly-cited "healthy"
 *   profit-factor benchmark, not derived from this codebase's own data).
 * - drawdown penalty (up to -20): reuses `computeMaxDrawdown`'s own
 *   `maxDrawdownPct` (already a 0-100 percentage) directly.
 */
export function computeBacktestQualityScore(metrics: BacktestOutcomeMetrics): BacktestQualityScore {
  if (metrics.totalTrades < MIN_SAMPLE_SIZE) {
    return { status: "insufficient_evidence", closedTrades: metrics.totalTrades, minimumRequired: MIN_SAMPLE_SIZE };
  }

  const winRateComponent = Math.round(WIN_RATE_COMPONENT_MAX * clamp01((metrics.winRate ?? 0) / 100));

  const riskAdjustedReturnComponent =
    metrics.riskAdjustedReturn.status === "computed"
      ? Math.round(RISK_ADJUSTED_COMPONENT_MAX * clamp01((metrics.riskAdjustedReturn.value + RISK_ADJUSTED_MAGNITUDE_BOUND) / (2 * RISK_ADJUSTED_MAGNITUDE_BOUND)))
      : 0;

  const profitFactorComponent =
    metrics.profitFactor !== null ? Math.round(PROFIT_FACTOR_COMPONENT_MAX * clamp01(metrics.profitFactor / PROFIT_FACTOR_REFERENCE)) : 0;

  const drawdownPenalty =
    metrics.maxDrawdown.status === "computed" && metrics.maxDrawdown.maxDrawdownPct !== null
      ? Math.round(DRAWDOWN_PENALTY_MAX * clamp01(metrics.maxDrawdown.maxDrawdownPct / 100))
      : 0;

  const score = clampScore(winRateComponent + riskAdjustedReturnComponent + profitFactorComponent - drawdownPenalty);

  return { status: "computed", score, breakdown: { winRateComponent, riskAdjustedReturnComponent, profitFactorComponent, drawdownPenalty } };
}
