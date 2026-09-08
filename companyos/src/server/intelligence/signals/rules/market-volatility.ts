import type { MarketMetrics } from "@/server/intelligence/signals/market-metrics";

export const RULE_NAME = "market_volatility";
export const RULE_VERSION = "v1";

/**
 * Average (high-low)/close percentage across the daily window
 * (`MarketMetrics.volatilityPct`, a simplified true-range percentage, no
 * external statistics library) required to count as elevated. Documented
 * starting boundaries for a major asset (BTC/ETH-class liquidity), not
 * derived from a backtest — the same "reasonable starting point, revisit
 * once real signal history exists" spirit every other market rule's
 * thresholds use.
 */
export const MEDIUM_THRESHOLD_PCT = 3;
const HIGH_THRESHOLD_PCT = 6;
const CRITICAL_THRESHOLD_PCT = 10;

/** Below this, volatility is low enough to matter for market-regime classification, even though it never fires this signal on its own. */
export const LOW_VOLATILITY_THRESHOLD_PCT = 1.5;

const SYSTEM_CONFIDENCE = 90;

export type MarketVolatilityEvaluation = {
  severity: "medium" | "high" | "critical";
  confidence: number;
  evidence: {
    symbol: string;
    volatilityPct: number;
    observedAt: string;
  };
};

/**
 * Deterministic, rule-based detection — no LLM call, fully unit-testable.
 * Only fires for ELEVATED volatility — a genuinely low-volatility market
 * isn't itself a signal worth surfacing as a `CompanySignal` the same way
 * a spike is (it's still a real input to `market-regime.ts`'s
 * classification, computed from the same underlying metric, just not
 * written as its own alert row here).
 */
export function evaluateMarketVolatility(metrics: MarketMetrics): MarketVolatilityEvaluation | null {
  if (metrics.volatilityPct < MEDIUM_THRESHOLD_PCT) return null;

  const severity =
    metrics.volatilityPct >= CRITICAL_THRESHOLD_PCT ? "critical" : metrics.volatilityPct >= HIGH_THRESHOLD_PCT ? "high" : "medium";

  return {
    severity,
    confidence: SYSTEM_CONFIDENCE,
    evidence: {
      symbol: metrics.symbol,
      volatilityPct: metrics.volatilityPct,
      observedAt: metrics.observedAt,
    },
  };
}
