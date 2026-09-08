import type { MarketMetricsSnapshotPayload, OpportunityScoreResult, MarketRiskEvaluation, MarketRiskCondition } from "@/server/intelligence/market-intelligence/types";

/**
 * The deterministic multi-signal eligibility gate for a market Opportunity
 * (Sprint 14 Phase 6). ALL conditions must hold — a single strong signal
 * (e.g. a big momentum move with no volume or trend behind it) is
 * explicitly NOT enough; the point of requiring agreement across several
 * independently-computed metrics is to filter out noise a single measure
 * would false-positive on. Each threshold's rationale:
 *
 * - `MOMENTUM_MIN_PCT` (3%): the same magnitude `market_price_momentum`
 *   itself uses to fire at all — below this, there's no real move to act on.
 * - `TREND_MIN_PCT`/`TREND_MIN_CONSISTENCY`: the medium-window move must
 *   also be real and sustained (not one outlier candle) and in the SAME
 *   direction as the daily move (upside only — opportunities are about
 *   upside; a strong downward move is evaluated as a Risk instead, see
 *   `risk/rules/market-multi-signal.ts`).
 * - `VOLUME_MIN_RATIO` (1.5x): softer than `market_volume_anomaly`'s own
 *   2.0x alert threshold — eligibility only needs SOME confirmation that
 *   real participation is behind the move, not an anomaly-grade spike.
 * - `VOLATILITY_MAX_PCT` (6%, matching volatility's own "high" boundary):
 *   excessive volatility reduces confidence that a move is genuine
 *   direction rather than noise/whipsaw.
 * - short-term must be non-negative: the immediate last ~2h hasn't already
 *   reversed against the move.
 */
export const MOMENTUM_MIN_PCT = 3;
export const TREND_MIN_PCT = 2;
export const TREND_MIN_CONSISTENCY = 0.6;
export const VOLUME_MIN_RATIO = 1.5;
export const VOLATILITY_MAX_PCT = 6;

export function evaluateMarketOpportunityEligibility(metrics: MarketMetricsSnapshotPayload): boolean {
  return (
    metrics.dailyPercentChange >= MOMENTUM_MIN_PCT &&
    metrics.mediumPercentChange >= TREND_MIN_PCT &&
    metrics.trendConsistency >= TREND_MIN_CONSISTENCY &&
    metrics.volumeRatio >= VOLUME_MIN_RATIO &&
    metrics.volatilityPct < VOLATILITY_MAX_PCT &&
    metrics.shortTermPercentChange >= 0
  );
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

const MOMENTUM_MAX_POINTS = 30;
const MOMENTUM_REFERENCE_PCT = 15;
const TREND_MAX_POINTS = 25;
const VOLUME_MAX_POINTS = 20;
const VOLUME_REFERENCE_RATIO = 4;
const RELATIVE_STRENGTH_MAX_POINTS = 15;
const RELATIVE_STRENGTH_REFERENCE_PCT = 10;
const VOLATILITY_PENALTY_MAX = 20;
const RISK_PENALTY = 15;

/**
 * Transparent, additive composite score (Phase 8) — never "a weighted
 * average nobody can explain." Each named contribution is independently
 * meaningful and capped, so no single input can dominate the score
 * unboundedly:
 *
 * - momentum (up to 30 of 100): the primary driver — is this actually
 *   moving. Scaled against a 15%-move reference ceiling.
 * - trend (up to 25): rewards sustained direction (via
 *   `trendConsistency`, already 0-1) over a single spike.
 * - volume (up to 20): real participation, scaled against a 4x-average
 *   reference ceiling.
 * - relative strength (up to 15): genuine outperformance vs. the
 *   benchmark, not just riding the broad market. Contributes 0 (never
 *   negative) when the symbol is underperforming despite rising.
 * - volatility penalty (up to -20): scales toward the eligibility
 *   ceiling itself, so a candidate that JUST cleared eligibility on
 *   volatility loses more points than one comfortably below it.
 * - risk penalty (-15 flat): if this same symbol ALSO triggered a
 *   `market_multi_signal_risk` condition this run, it ranks below an
 *   otherwise-equal, risk-clean candidate.
 *
 * Final score is clamped to [0, 100], the same convention
 * `CompanyHealthSnapshot.salesHealthScore` already uses.
 */
export function computeOpportunityScore(metrics: MarketMetricsSnapshotPayload, riskFlagged: boolean): OpportunityScoreResult {
  const momentumContribution = Math.round(MOMENTUM_MAX_POINTS * clamp01(metrics.dailyPercentChange / MOMENTUM_REFERENCE_PCT));
  const trendContribution = Math.round(TREND_MAX_POINTS * clamp01(metrics.trendConsistency));
  const volumeContribution = Math.round(VOLUME_MAX_POINTS * clamp01(metrics.volumeRatio / VOLUME_REFERENCE_RATIO));
  const relativeStrengthContribution = Math.round(RELATIVE_STRENGTH_MAX_POINTS * clamp01(metrics.relativeStrength / RELATIVE_STRENGTH_REFERENCE_PCT));
  const volatilityPenalty = Math.round(VOLATILITY_PENALTY_MAX * clamp01(metrics.volatilityPct / VOLATILITY_MAX_PCT));
  const riskPenalty = riskFlagged ? RISK_PENALTY : 0;

  const rawScore = momentumContribution + trendContribution + volumeContribution + relativeStrengthContribution - volatilityPenalty - riskPenalty;
  const score = Math.max(0, Math.min(100, rawScore));

  return {
    score,
    breakdown: { momentumContribution, trendContribution, volumeContribution, relativeStrengthContribution, volatilityPenalty, riskPenalty },
  };
}

/**
 * Confidence here means "how strongly the observable evidence clears the
 * deterministic eligibility bar" (Phase 10) — NEVER an LLM's self-reported
 * confidence, NEVER a probability of profit. Computed purely from how far
 * each of the 4 eligibility inputs sits above its own minimum threshold
 * (an "evidence margin"), averaged and mapped onto [70, 95] — 70 is the
 * floor because clearing the deterministic gate at all is already real
 * evidence; 95 is the ceiling because this is a heuristic composite of
 * real signals, never treated as certainty.
 */
export function computeMarketConfidence(metrics: MarketMetricsSnapshotPayload): number {
  const margins = [
    (metrics.dailyPercentChange - MOMENTUM_MIN_PCT) / MOMENTUM_MIN_PCT,
    (metrics.mediumPercentChange - TREND_MIN_PCT) / TREND_MIN_PCT,
    (metrics.trendConsistency - TREND_MIN_CONSISTENCY) / (1 - TREND_MIN_CONSISTENCY),
    (metrics.volumeRatio - VOLUME_MIN_RATIO) / VOLUME_MIN_RATIO,
  ].map(clamp01);
  const averageMargin = margins.reduce((sum, v) => sum + v, 0) / margins.length;
  return Math.round(70 + 25 * averageMargin);
}

const REVERSAL_THRESHOLD_PCT = 1.5;
const TREND_BREAKDOWN_CONSISTENCY = 0.4;
const TREND_BREAKDOWN_MIN_DAILY_PCT = 3;
const CONFLICTING_SIGNALS_THRESHOLD_PCT = 3;
export const EXTREME_MOVE_THRESHOLD_PCT = 20;

/**
 * Market-observable risk (Phase 7) — deliberately OR-based, not AND: risk
 * management is more permissive than opportunity eligibility on purpose,
 * any one real red flag is worth surfacing (matching real risk-management
 * practice), unlike an opportunity which needs everything to align. No
 * account/position data is used or invented — every condition here is
 * computable purely from this run's own market metrics:
 *
 * - `excessive_volatility`: at/above `market_volatility`'s own "high"
 *   boundary.
 * - `momentum_reversal`: the daily move was one direction, but the very
 *   recent short-term window has already swung meaningfully the other way.
 * - `trend_breakdown`: a nontrivial daily move exists, but the medium
 *   window shows LOW consistency — the 24h number is being driven by
 *   outlier candles, not real sustained direction.
 * - `conflicting_signals`: the daily move and relative-strength spread
 *   point in opposite directions with real magnitude on each side.
 * - `extreme_move`: an outsized move regardless of anything else — always
 *   worth flagging on its own.
 *
 * Severity is the MAX across every condition that actually fired.
 */
export function evaluateMarketRiskConditions(metrics: MarketMetricsSnapshotPayload): MarketRiskEvaluation {
  const conditions: MarketRiskCondition[] = [];
  let severity: "medium" | "high" | "critical" = "medium";
  const escalate = (s: "medium" | "high" | "critical") => {
    const order = { medium: 0, high: 1, critical: 2 };
    if (order[s] > order[severity]) severity = s;
  };

  if (metrics.volatilityPct >= VOLATILITY_MAX_PCT) {
    conditions.push("excessive_volatility");
    escalate(metrics.volatilityPct >= 10 ? "critical" : "high");
  }

  const reversedUp = metrics.dailyPercentChange >= MOMENTUM_MIN_PCT && metrics.shortTermPercentChange <= -REVERSAL_THRESHOLD_PCT;
  const reversedDown = metrics.dailyPercentChange <= -MOMENTUM_MIN_PCT && metrics.shortTermPercentChange >= REVERSAL_THRESHOLD_PCT;
  if (reversedUp || reversedDown) {
    conditions.push("momentum_reversal");
    escalate("high");
  }

  if (metrics.trendConsistency < TREND_BREAKDOWN_CONSISTENCY && Math.abs(metrics.dailyPercentChange) >= TREND_BREAKDOWN_MIN_DAILY_PCT) {
    conditions.push("trend_breakdown");
    escalate("medium");
  }

  const conflicting =
    (metrics.dailyPercentChange >= CONFLICTING_SIGNALS_THRESHOLD_PCT && metrics.relativeStrength <= -CONFLICTING_SIGNALS_THRESHOLD_PCT) ||
    (metrics.dailyPercentChange <= -CONFLICTING_SIGNALS_THRESHOLD_PCT && metrics.relativeStrength >= CONFLICTING_SIGNALS_THRESHOLD_PCT);
  if (conflicting) {
    conditions.push("conflicting_signals");
    escalate("medium");
  }

  if (Math.abs(metrics.dailyPercentChange) >= EXTREME_MOVE_THRESHOLD_PCT) {
    conditions.push("extreme_move");
    escalate("critical");
  }

  if (conditions.length === 0) return null;
  return { conditions, severity };
}
