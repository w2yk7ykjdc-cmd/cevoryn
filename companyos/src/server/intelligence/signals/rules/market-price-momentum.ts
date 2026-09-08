import type { Candle } from "@/server/market-data/types";

export const RULE_NAME = "market_price_momentum";
export const RULE_VERSION = "v1";

/**
 * Percent-change thresholds for a 24-hour closing-price move (24 hourly
 * candles = one full day). Chosen as starting, documented boundaries for a
 * major asset (BTC/ETH) rather than derived from any statistical backtest
 * — the same "a reasonable, explainable starting point, not a universal
 * truth" spirit `high-value-stalled-lead.ts`'s own thresholds use. A future
 * sprint can revisit these once real signal history exists to evaluate
 * against (via the Outcome/Learning loop these signals are positioned to
 * eventually feed).
 */
const MEDIUM_THRESHOLD_PCT = 3;
const HIGH_THRESHOLD_PCT = 7;
const CRITICAL_THRESHOLD_PCT = 15;

/** Every evaluation the rule was actually built on had a full, real 24-candle window — never a partial/guessed one. */
const SYSTEM_CONFIDENCE = 90;

export type MarketPriceMomentumEvaluation = {
  severity: "medium" | "high" | "critical";
  confidence: number;
  direction: "up" | "down";
  evidence: {
    symbol: string;
    interval: string;
    windowCandles: number;
    percentChange: number;
    referenceClose: string;
    mostRecentClose: string;
    referenceObservedAt: string;
    mostRecentObservedAt: string;
  };
};

/**
 * Deterministic, rule-based detection — no LLM call, fully unit-testable.
 * "Momentum": the most recent candle's close vs. the close of the OLDEST
 * candle in the window (24 hourly candles = a 24h price change), the same
 * standard "24h change" metric every major exchange/ticker already
 * surfaces, computed here directly from klines rather than a separate
 * ticker endpoint so the exact inputs are auditable in the resulting
 * signal's own evidence.
 *
 * Requires the FULL requested window — a partial candle history (fewer
 * candles than requested, e.g. a young listing or an incomplete fetch)
 * returns `null` rather than computing a lower-confidence guess: "not
 * enough evidence yet" is never conflated with a real, if smaller,
 * measured move (the same discipline `Outcome`'s
 * `insufficient_evidence` state already applies elsewhere in this
 * codebase).
 *
 * Below `MEDIUM_THRESHOLD_PCT`, this returns `null` — a quiet market is
 * not itself a signal; this rule only fires on a genuine move.
 */
export function evaluateMarketPriceMomentum(
  candles: Candle[],
  symbol: string,
  interval: string,
  expectedWindow: number,
): MarketPriceMomentumEvaluation | null {
  if (candles.length !== expectedWindow) return null;

  const reference = candles[0]!;
  const mostRecent = candles[candles.length - 1]!;

  const referenceClose = Number(reference.close);
  const mostRecentClose = Number(mostRecent.close);
  if (referenceClose <= 0) return null; // cannot compute a percent change from a non-positive base

  const percentChange = ((mostRecentClose - referenceClose) / referenceClose) * 100;
  const magnitude = Math.abs(percentChange);
  if (magnitude < MEDIUM_THRESHOLD_PCT) return null;

  const severity = magnitude >= CRITICAL_THRESHOLD_PCT ? "critical" : magnitude >= HIGH_THRESHOLD_PCT ? "high" : "medium";

  return {
    severity,
    confidence: SYSTEM_CONFIDENCE,
    direction: percentChange >= 0 ? "up" : "down",
    evidence: {
      symbol,
      interval,
      windowCandles: candles.length,
      percentChange: Math.round(percentChange * 100) / 100,
      referenceClose: reference.close,
      mostRecentClose: mostRecent.close,
      referenceObservedAt: reference.closeTime.toISOString(),
      mostRecentObservedAt: mostRecent.closeTime.toISOString(),
    },
  };
}
