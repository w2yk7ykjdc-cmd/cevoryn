import type { MarketMetricsSnapshotPayload } from "@/server/intelligence/signals/market-scanner";

export type { MarketMetricsSnapshotPayload };

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
};
