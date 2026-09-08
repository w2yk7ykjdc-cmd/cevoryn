import type { SignalSeverity } from "@prisma/client";
import type { MarketMetricsSnapshotPayload, OpportunityScoreResult } from "@/server/intelligence/market-intelligence/types";

export const RULE_NAME = "market_multi_signal_opportunity";
export const RULE_VERSION = "v1";

export type GeneratedMarketOpportunity = {
  type: string;
  title: string;
  description: string;
  score: number;
  confidence: number;
  potentialImpact: number;
  effort: "low" | "medium" | "high";
  urgency: SignalSeverity;
  risk: SignalSeverity;
  evidence: Record<string, unknown>;
  explanation: string;
  relatedEntityType: string;
  relatedEntityId: string;
  ruleName: string;
  ruleVersion: string;
};

function severityFromPercent(magnitude: number): SignalSeverity {
  if (magnitude >= 15) return "critical";
  if (magnitude >= 7) return "high";
  return "medium";
}

/**
 * Builds the `Opportunity` fields for a symbol that already passed
 * `evaluateMarketOpportunityEligibility` (`market-intelligence/scoring.ts`)
 * — this function does NOT re-check eligibility, it only constructs the
 * record. Deliberately given its own distinct `ruleName` (rather than
 * reusing `market_price_momentum`'s, the way `high_value_stalled_lead`'s
 * opportunity rule reuses its own signal's rule identity 1:1) because this
 * opportunity is a genuine composite of 5 independent metrics, not a
 * single signal's direct projection — giving it its own identity keeps it
 * distinctly filterable/reportable (e.g. in a future
 * `getRulePerformance` call) rather than conflated with the standalone
 * momentum alert signal.
 *
 * `potentialImpact` is `0` — DELIBERATELY, not an oversight. No
 * account/position data exists to compute a real dollar figure (Sprint 14
 * explicitly forbids fabricating one — "amount uydurma, dolar değeri
 * uydurma, ROI uydurma"). Real prioritization for market opportunities is
 * carried by `score` (this composite, evidence-based 0-100 value) and
 * consumed by `market-intelligence/ranking.ts`, never by this field.
 */
export function buildMarketOpportunity(
  metrics: MarketMetricsSnapshotPayload,
  scoreResult: OpportunityScoreResult,
  confidence: number,
  riskFlagged: boolean,
): GeneratedMarketOpportunity {
  return {
    type: RULE_NAME,
    title: `${metrics.symbol}: confirmed upward momentum`,
    description:
      `${metrics.symbol} is up ${metrics.dailyPercentChange}% over 24h, with a consistent medium-term trend ` +
      `(${Math.round(metrics.trendConsistency * 100)}% directional consistency) and ${metrics.volumeRatio}x average volume confirming it.`,
    score: scoreResult.score,
    confidence,
    potentialImpact: 0,
    effort: "low",
    urgency: severityFromPercent(Math.abs(metrics.dailyPercentChange)),
    risk: severityFromPercent(metrics.volatilityPct),
    evidence: {
      isMarketOpportunity: true,
      symbol: metrics.symbol,
      dailyPercentChange: metrics.dailyPercentChange,
      shortTermPercentChange: metrics.shortTermPercentChange,
      mediumPercentChange: metrics.mediumPercentChange,
      trendConsistency: metrics.trendConsistency,
      volumeRatio: metrics.volumeRatio,
      volatilityPct: metrics.volatilityPct,
      relativeStrength: metrics.relativeStrength,
      scoreBreakdown: scoreResult.breakdown,
      riskFlagged,
      observedAt: metrics.observedAt,
      potentialImpactNote: "Not computable without account/position data -- deliberately 0, not fabricated. See score for real prioritization.",
    },
    explanation:
      `${metrics.symbol} cleared all 5 deterministic eligibility conditions this run: momentum, trend, volume ` +
      `confirmation, acceptable volatility, and no short-term reversal. Composite score ${scoreResult.score}/100.`,
    relatedEntityType: "MarketSymbol",
    relatedEntityId: metrics.symbol,
    ruleName: RULE_NAME,
    ruleVersion: RULE_VERSION,
  };
}
