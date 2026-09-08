import type { SignalSeverity } from "@prisma/client";
import type { MarketMetricsSnapshotPayload, MarketRiskCondition } from "@/server/intelligence/market-intelligence/types";

export const RULE_NAME = "market_multi_signal_risk";
export const RULE_VERSION = "v1";

export type GeneratedMarketRisk = {
  type: string;
  title: string;
  description: string;
  severity: SignalSeverity;
  confidence: number;
  potentialLoss: number;
  evidence: Record<string, unknown>;
  explanation: string;
  relatedEntityType: string;
  relatedEntityId: string;
  ruleName: string;
  ruleVersion: string;
};

const CONDITION_LABELS: Record<MarketRiskCondition, string> = {
  excessive_volatility: "excessive volatility",
  momentum_reversal: "a momentum reversal against the 24h direction",
  trend_breakdown: "a trend breakdown (the daily move lacks sustained support)",
  conflicting_signals: "conflicting signals (daily move vs. relative strength disagree)",
  extreme_move: "an extreme price move",
};

/**
 * Builds the `Risk` fields for a symbol whose metrics already triggered
 * `evaluateMarketRiskConditions` (`market-intelligence/scoring.ts`) — this
 * function does NOT re-evaluate conditions, only constructs the record.
 *
 * `potentialLoss` is `0` for the identical reason
 * `market-multi-signal_opportunity`'s `potentialImpact` is: no
 * account/position data exists this sprint to compute a real dollar
 * figure, and Sprint 14 explicitly forbids fabricating one. This is
 * market-OBSERVABLE risk only (Phase 7's own explicit scope) — a future
 * sprint that adds account/position visibility is where a real dollar
 * loss estimate could be computed, marked FUTURE WORK, never invented
 * here. There is also no `score` field on `Risk` (unlike `Opportunity`) —
 * a `riskScore` (0-100, same scale) is carried in `evidence` instead for
 * `market-intelligence/ranking.ts` to read back.
 */
export function buildMarketRisk(
  metrics: MarketMetricsSnapshotPayload,
  conditions: MarketRiskCondition[],
  severity: SignalSeverity,
  confidence: number,
): GeneratedMarketRisk {
  const riskScore = Math.min(100, conditions.length * 25 + (severity === "critical" ? 25 : severity === "high" ? 15 : 0));
  const labels = conditions.map((c) => CONDITION_LABELS[c]);

  return {
    type: RULE_NAME,
    title: `${metrics.symbol}: ${labels[0]}`,
    description: `${metrics.symbol} triggered ${conditions.length} market-observable risk condition(s): ${labels.join(", ")}.`,
    severity,
    confidence,
    potentialLoss: 0,
    evidence: {
      isMarketRisk: true,
      symbol: metrics.symbol,
      conditions,
      riskScore,
      dailyPercentChange: metrics.dailyPercentChange,
      shortTermPercentChange: metrics.shortTermPercentChange,
      mediumPercentChange: metrics.mediumPercentChange,
      trendConsistency: metrics.trendConsistency,
      volumeRatio: metrics.volumeRatio,
      volatilityPct: metrics.volatilityPct,
      relativeStrength: metrics.relativeStrength,
      observedAt: metrics.observedAt,
      potentialLossNote: "Not computable without account/position data -- deliberately 0, not fabricated. Position-specific risk is future work.",
    },
    explanation: `Market-observable conditions detected for ${metrics.symbol}: ${labels.join("; ")}.`,
    relatedEntityType: "MarketSymbol",
    relatedEntityId: metrics.symbol,
    ruleName: RULE_NAME,
    ruleVersion: RULE_VERSION,
  };
}
