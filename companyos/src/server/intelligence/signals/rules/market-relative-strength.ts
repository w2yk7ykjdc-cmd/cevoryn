import type { MarketMetrics } from "@/server/intelligence/signals/market-metrics";
import { BENCHMARK_SYMBOL } from "@/server/market-data/types";

export const RULE_NAME = "market_relative_strength";
export const RULE_VERSION = "v1";

/**
 * The spread (in percentage points) between a symbol's own 24h move and
 * the benchmark's (BTC's, the standard crypto-market reference asset) 24h
 * move, thresholded the same way `market_price_momentum` thresholds an
 * absolute move — both are percentage-point measures on a comparable
 * scale, so reusing the same 3/7/15 boundaries is a defensible, documented
 * choice rather than inventing an unrelated scale.
 */
const MEDIUM_THRESHOLD_PCT = 3;
const HIGH_THRESHOLD_PCT = 7;
const CRITICAL_THRESHOLD_PCT = 15;

const SYSTEM_CONFIDENCE = 90;

export type MarketRelativeStrengthEvaluation = {
  severity: "medium" | "high" | "critical";
  confidence: number;
  direction: "outperform" | "underperform";
  evidence: {
    symbol: string;
    symbolDailyPercentChange: number;
    benchmarkSymbol: string;
    benchmarkDailyPercentChange: number;
    relativeStrength: number;
    observedAt: string;
  };
};

/**
 * Deterministic, rule-based detection — no LLM call, fully unit-testable.
 * "Relative strength": is this symbol moving meaningfully differently than
 * the broad market's own bellwether (BTC)? A symbol up 5% while BTC is up
 * 4% is not genuinely outperforming (both are just riding the same market
 * move) — the SPREAD, not either asset's own absolute change, is the real
 * signal. Never evaluated for the benchmark symbol against itself (spread
 * is trivially 0 — the caller skips this case).
 */
export function evaluateMarketRelativeStrength(
  metrics: MarketMetrics,
  benchmarkDailyPercentChange: number,
): MarketRelativeStrengthEvaluation | null {
  const relativeStrength = Math.round((metrics.dailyPercentChange - benchmarkDailyPercentChange) * 100) / 100;
  const magnitude = Math.abs(relativeStrength);
  if (magnitude < MEDIUM_THRESHOLD_PCT) return null;

  const severity = magnitude >= CRITICAL_THRESHOLD_PCT ? "critical" : magnitude >= HIGH_THRESHOLD_PCT ? "high" : "medium";

  return {
    severity,
    confidence: SYSTEM_CONFIDENCE,
    direction: relativeStrength >= 0 ? "outperform" : "underperform",
    evidence: {
      symbol: metrics.symbol,
      symbolDailyPercentChange: metrics.dailyPercentChange,
      benchmarkSymbol: BENCHMARK_SYMBOL,
      benchmarkDailyPercentChange,
      relativeStrength,
      observedAt: metrics.observedAt,
    },
  };
}
