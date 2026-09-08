import type { MarketMetrics } from "@/server/intelligence/signals/market-metrics";

export const RULE_NAME = "market_trend";
export const RULE_VERSION = "v1";

/**
 * Applied to the ~12h medium window (shorter than momentum's 24h window),
 * so the magnitude bar is set lower -- a real, sustained 12h move is
 * meaningful at a smaller percentage than a 24h one.
 */
const MEDIUM_THRESHOLD_PCT = 2;
const HIGH_THRESHOLD_PCT = 5;
const CRITICAL_THRESHOLD_PCT = 10;

/** The move must also be CONSISTENT, not just large -- see `MarketMetrics.trendConsistency`'s own doc comment. */
const MIN_CONSISTENCY = 0.6;

const SYSTEM_CONFIDENCE = 90;

export type MarketTrendEvaluation = {
  severity: "medium" | "high" | "critical";
  confidence: number;
  direction: "up" | "down";
  evidence: {
    symbol: string;
    mediumPercentChange: number;
    trendConsistency: number;
    observedAt: string;
  };
};

/**
 * Deterministic, rule-based detection — no LLM call, fully unit-testable.
 * "Trend" (as distinct from momentum): a medium-window move that is BOTH
 * large enough AND consistent enough that it reflects sustained direction
 * rather than one outlier candle. A large `mediumPercentChange` with low
 * `trendConsistency` (a single spike) does NOT fire this rule — that's
 * exactly the case `market_price_momentum` already covers on its own
 * 24h window, and conflating the two would just double-count the same
 * event under two names.
 */
export function evaluateMarketTrend(metrics: MarketMetrics): MarketTrendEvaluation | null {
  const magnitude = Math.abs(metrics.mediumPercentChange);
  if (magnitude < MEDIUM_THRESHOLD_PCT || metrics.trendConsistency < MIN_CONSISTENCY) return null;

  const severity = magnitude >= CRITICAL_THRESHOLD_PCT ? "critical" : magnitude >= HIGH_THRESHOLD_PCT ? "high" : "medium";

  return {
    severity,
    confidence: SYSTEM_CONFIDENCE,
    direction: metrics.mediumPercentChange >= 0 ? "up" : "down",
    evidence: {
      symbol: metrics.symbol,
      mediumPercentChange: metrics.mediumPercentChange,
      trendConsistency: metrics.trendConsistency,
      observedAt: metrics.observedAt,
    },
  };
}
