import type { MarketMetricsSnapshotPayload } from "@/server/intelligence/signals/market-scanner";
import type { StrategyCandidate } from "@/server/intelligence/strategy/types";

export type { MarketMetricsSnapshotPayload };
export type { StrategyCandidate };

export type OpportunityScoreBreakdown = {
  momentumContribution: number;
  trendContribution: number;
  volumeContribution: number;
  relativeStrengthContribution: number;
  volatilityPenalty: number;
  riskPenalty: number;
};

export type OpportunityScoreResult = {
  score: number;
  breakdown: OpportunityScoreBreakdown;
};

export type MarketRiskCondition = "excessive_volatility" | "momentum_reversal" | "trend_breakdown" | "conflicting_signals" | "extreme_move";

export type MarketRiskEvaluation = {
  conditions: MarketRiskCondition[];
  severity: "medium" | "high" | "critical";
} | null;

export type RankedMarketCandidate = {
  symbol: string;
  opportunityScore: number | null;
  riskSeverity: "low" | "medium" | "high" | "critical" | "none";
  confidence: number | null;
  regime: string | null;
  reasons: string[];
  riskReasons: string[];
  updatedAt: string;
  /** Sprint 15: the deterministic strategy candidate for this symbol, if the strategy engine has run since. `null` only when no `market_strategy_candidate.v1` signal exists yet -- never a placeholder guess. */
  strategy: StrategyCandidate | null;
  /**
   * Sprint 17: `opportunityScore * historicalFactor`, clamped to [0, 100] --
   * the ranking sort key. Identical to `opportunityScore` (historicalFactor
   * `1.0`) whenever this strategy type has fewer than
   * `decision-intelligence/sample-safety.ts#MIN_SAMPLE_SIZE` evaluated
   * paper trades, so ranking never changes until real measured history
   * actually exists -- historical performance is a bounded SUPPORTING
   * signal on top of current market evidence, never a replacement for it
   * (Sprint 17 Phase 7's own explicit rule).
   */
  priorityScore: number;
  /** The bounded [0.5, 1.0] multiplier actually applied -- `1.0` when there is no sufficient historical sample yet. */
  historicalFactor: number;
};

/** Per-strategy-type historical performance, already Laplace-shrunk and sample-size-classified (`strategy-performance/service.ts#getStrategyTypePerformance`) -- the exact shape `rankMarketCandidates` consumes for Phase 7's ranking adjustment. */
export type StrategyHistoricalPerformance = {
  shrunkWinRate: number;
  evaluatedTrades: number;
  sampleSizeStatus: "insufficient_sample" | "sufficient_sample";
};
