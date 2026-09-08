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
};
