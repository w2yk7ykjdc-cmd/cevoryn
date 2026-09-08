import type { MarketMetrics } from "@/server/intelligence/signals/market-metrics";
import { LOW_VOLATILITY_THRESHOLD_PCT, MEDIUM_THRESHOLD_PCT as HIGH_VOLATILITY_THRESHOLD_PCT } from "@/server/intelligence/signals/rules/market-volatility";
import { BENCHMARK_SYMBOL } from "@/server/market-data/types";

export const RULE_NAME = "market_regime";
export const RULE_VERSION = "v1";

const TREND_CONSISTENCY_THRESHOLD = 0.65;
const RANGING_CONSISTENCY_THRESHOLD = 0.45;
const TREND_MIN_MEDIUM_CHANGE_PCT = 2;

/** Fixed rather than computed: the classification itself is fully deterministic from real data; this is "how reliable is bucketing a continuous reality into 5 discrete regimes," not evidence strength for one specific measurement. */
const REGIME_CONFIDENCE = 85;

export type MarketRegime = "trending" | "ranging" | "high_volatility" | "low_volatility" | "uncertain";

export type MarketRegimeEvaluation = {
  regime: MarketRegime;
  /**
   * Reuses `SignalSeverity` as "how much this regime should weight
   * opportunity/risk scoring" (not literally risk severity) — the same
   * domain-reinterpretation `Opportunity.urgency`/`Risk.severity` already
   * apply to the identical enum elsewhere in this codebase.
   */
  severity: "low" | "medium" | "high" | "critical";
  confidence: number;
  evidence: {
    benchmarkSymbol: string;
    volatilityPct: number;
    trendConsistency: number;
    mediumPercentChange: number;
    observedAt: string;
  };
};

/**
 * Deterministic, rule-based classification — no LLM call, fully
 * unit-testable. Uses the benchmark's (BTC's) own metrics as the market's
 * overall bellwether, the standard crypto-market convention: altcoins
 * broadly follow BTC's regime, so classifying off one reference asset
 * (rather than averaging across the whole discovered universe, which
 * would just be noisier without being more correct) is a deliberate,
 * documented simplification.
 *
 * Priority order: volatility extremes are checked first (a genuinely
 * chaotic or genuinely dead market overrides any trend reading), then
 * trend consistency, with "uncertain" as the honest fallback when neither
 * a clean trend nor a clean range is present.
 */
export function classifyMarketRegime(benchmarkMetrics: MarketMetrics): MarketRegimeEvaluation {
  const evidence = {
    benchmarkSymbol: BENCHMARK_SYMBOL,
    volatilityPct: benchmarkMetrics.volatilityPct,
    trendConsistency: benchmarkMetrics.trendConsistency,
    mediumPercentChange: benchmarkMetrics.mediumPercentChange,
    observedAt: benchmarkMetrics.observedAt,
  };

  if (benchmarkMetrics.volatilityPct >= HIGH_VOLATILITY_THRESHOLD_PCT) {
    return { regime: "high_volatility", severity: "critical", confidence: REGIME_CONFIDENCE, evidence };
  }
  if (benchmarkMetrics.volatilityPct <= LOW_VOLATILITY_THRESHOLD_PCT) {
    return { regime: "low_volatility", severity: "low", confidence: REGIME_CONFIDENCE, evidence };
  }
  if (
    benchmarkMetrics.trendConsistency >= TREND_CONSISTENCY_THRESHOLD &&
    Math.abs(benchmarkMetrics.mediumPercentChange) >= TREND_MIN_MEDIUM_CHANGE_PCT
  ) {
    return { regime: "trending", severity: "medium", confidence: REGIME_CONFIDENCE, evidence };
  }
  if (benchmarkMetrics.trendConsistency <= RANGING_CONSISTENCY_THRESHOLD) {
    return { regime: "ranging", severity: "low", confidence: REGIME_CONFIDENCE, evidence };
  }
  return { regime: "uncertain", severity: "low", confidence: REGIME_CONFIDENCE, evidence };
}
