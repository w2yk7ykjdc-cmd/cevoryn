import type { MarketMetrics } from "@/server/intelligence/signals/market-metrics";

export const RULE_NAME = "market_volume_anomaly";
export const RULE_VERSION = "v1";

/** How many times the recent 24h average volume the latest hour must reach to count as anomalous. */
const MEDIUM_RATIO = 2.0;
const HIGH_RATIO = 3.5;
const CRITICAL_RATIO = 6.0;

const SYSTEM_CONFIDENCE = 90;

export type MarketVolumeAnomalyEvaluation = {
  severity: "medium" | "high" | "critical";
  confidence: number;
  evidence: {
    symbol: string;
    volumeRatio: number;
    observedAt: string;
  };
};

/**
 * Deterministic, rule-based detection — no LLM call, fully unit-testable.
 * A simple, explainable ratio: the most recent hourly candle's volume
 * divided by the average of the prior 24 hours (`MarketMetrics.volumeRatio`).
 * No fabricated statistical model (z-score, standard-deviation bands) —
 * just "how many times the recent average is this hour trading," which
 * is directly the number a human/AI reader can sanity-check against the
 * raw evidence.
 */
export function evaluateMarketVolumeAnomaly(metrics: MarketMetrics): MarketVolumeAnomalyEvaluation | null {
  if (metrics.volumeRatio < MEDIUM_RATIO) return null;

  const severity = metrics.volumeRatio >= CRITICAL_RATIO ? "critical" : metrics.volumeRatio >= HIGH_RATIO ? "high" : "medium";

  return {
    severity,
    confidence: SYSTEM_CONFIDENCE,
    evidence: {
      symbol: metrics.symbol,
      volumeRatio: metrics.volumeRatio,
      observedAt: metrics.observedAt,
    },
  };
}
