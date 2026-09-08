import {
  MOMENTUM_MIN_PCT,
  TREND_MIN_PCT,
  TREND_MIN_CONSISTENCY,
  VOLATILITY_MAX_PCT,
} from "@/server/intelligence/market-intelligence/scoring";
import { LOW_VOLATILITY_THRESHOLD_PCT } from "@/server/intelligence/signals/rules/market-volatility";
import type { StrategyCandidate, StrategyInput, StrategyType, NoTradeReason, StrategyDirection } from "@/server/intelligence/strategy/types";

export const STRATEGY_VERSION = "v1";

/**
 * How old a `market_metrics_snapshot.v1` row is allowed to be before the
 * strategy engine refuses to act on it (Phase: STALE DATA). Ingestion
 * (`ingest-market-data`) runs hourly; 3x that cadence tolerates one or two
 * missed/failed runs (the same symbol-level-failure-isolation spirit
 * Sprint 14's own ingestion already applies) before data is treated as
 * genuinely stale rather than momentarily behind schedule.
 */
export const STALE_DATA_MAX_AGE_MS = 3 * 60 * 60 * 1000;

/**
 * A `Risk` severity this strong makes any strategy thesis for the same
 * symbol unsound this run, regardless of how good the opportunity looks —
 * directly implements the spec's own worked example ("Opportunity score
 * high + Risk unacceptable = NO_TRADE"). `medium` severity is recorded as a
 * contradicting signal / confidence drag, not an automatic veto — matching
 * `evaluateMarketRiskConditions`'s own severity ladder, where `medium` is
 * the baseline for a single real-but-modest red flag.
 */
const UNACCEPTABLE_RISK_SEVERITIES = new Set(["high", "critical"]);

/** The very recent (~2h) window must itself still be moving in the momentum's own direction — reused as MOMENTUM_CONTINUATION's defining trait vs. TREND_FOLLOWING's longer, steadier window. */
const MOMENTUM_CONTINUATION_SHORT_MIN_PCT = 1;

/**
 * Relative-strength magnitude required to "support" a momentum-continuation
 * thesis — matches `market_relative_strength`'s own medium alert threshold
 * (that rule's `MEDIUM_THRESHOLD_PCT`, not exported, so restated here with
 * the same documented value and rationale: the smallest spread worth
 * calling a real divergence from the benchmark).
 */
const RELATIVE_STRENGTH_SUPPORT_PCT = 3;

/** How far short-term price action must have moved AGAINST the daily direction to count as a reversal that invalidates a directional thesis — matches `evaluateMarketRiskConditions`'s own `REVERSAL_THRESHOLD_PCT`. */
const REVERSAL_THRESHOLD_PCT = 1.5;

/** Matches `market-regime.ts`'s own `RANGING_CONSISTENCY_THRESHOLD` (not exported there) — the same bar for "this symbol's own recent moves aren't going anywhere in particular." */
const MEAN_REVERSION_MAX_TREND_CONSISTENCY = 0.45;

type StrategyEvaluation = {
  strategyType: StrategyType;
  direction: StrategyDirection | null;
  supportingSignals: string[];
  contradictingSignals: string[];
  entryConditions: string[];
  invalidationConditions: string[];
};

function isStale(observedAt: string, now: number): boolean {
  return now - new Date(observedAt).getTime() > STALE_DATA_MAX_AGE_MS;
}

/**
 * TREND_FOLLOWING (Phase: STRATEGY TYPES #1): the strongest, most demanding
 * thesis — requires the SAME sustained-direction evidence
 * `evaluateMarketOpportunityEligibility` already requires (medium-window
 * move real AND consistent), the 24h move agreeing in direction and
 * magnitude, acceptable volatility, and no short-term reversal already
 * underway. Checked first because it needs the most evidence to support.
 */
function evaluateTrendFollowing(input: StrategyInput): StrategyEvaluation | null {
  const { metrics } = input;
  const trendReal = Math.abs(metrics.mediumPercentChange) >= TREND_MIN_PCT && metrics.trendConsistency >= TREND_MIN_CONSISTENCY;
  if (!trendReal) return null;

  const direction: StrategyDirection = metrics.mediumPercentChange >= 0 ? "up" : "down";
  const dailyAgrees = direction === "up" ? metrics.dailyPercentChange >= MOMENTUM_MIN_PCT : metrics.dailyPercentChange <= -MOMENTUM_MIN_PCT;
  if (!dailyAgrees) return null;

  if (metrics.volatilityPct >= VOLATILITY_MAX_PCT) return null;

  const reversing =
    direction === "up" ? metrics.shortTermPercentChange <= -REVERSAL_THRESHOLD_PCT : metrics.shortTermPercentChange >= REVERSAL_THRESHOLD_PCT;
  if (reversing) return null;

  return {
    strategyType: "TREND_FOLLOWING",
    direction,
    supportingSignals: [
      `medium-term trend ${direction} (${metrics.mediumPercentChange}%, ${Math.round(metrics.trendConsistency * 100)}% consistent)`,
      `24h move agrees (${metrics.dailyPercentChange}%)`,
      `no short-term reversal (${metrics.shortTermPercentChange}%)`,
    ],
    contradictingSignals: [],
    entryConditions: [
      `medium-term trend consistency stays >= ${TREND_MIN_CONSISTENCY}`,
      `24h move stays ${direction === "up" ? "positive" : "negative"} and >= ${MOMENTUM_MIN_PCT}% in magnitude`,
      `volatility stays below ${VOLATILITY_MAX_PCT}%`,
    ],
    invalidationConditions: [
      `trend consistency falls below ${TREND_MIN_CONSISTENCY}`,
      `short-term price action reverses >= ${REVERSAL_THRESHOLD_PCT}% against the trend`,
      `volatility reaches ${VOLATILITY_MAX_PCT}% or higher`,
      "source market data becomes stale",
    ],
  };
}

/**
 * MOMENTUM_CONTINUATION (Phase: STRATEGY TYPES #2): a lighter-weight,
 * shorter-horizon thesis than TREND_FOLLOWING — doesn't require the medium
 * window's sustained consistency, but does require the very recent (~2h)
 * window to ALSO be moving (not just the 24h number), plus relative
 * strength actually supporting the same direction. Checked second: a
 * candidate that already qualified as TREND_FOLLOWING is never
 * double-classified here.
 */
function evaluateMomentumContinuation(input: StrategyInput): StrategyEvaluation | null {
  const { metrics } = input;
  const dailyMoving = Math.abs(metrics.dailyPercentChange) >= MOMENTUM_MIN_PCT;
  if (!dailyMoving) return null;

  const direction: StrategyDirection = metrics.dailyPercentChange >= 0 ? "up" : "down";
  const shortAgrees =
    direction === "up"
      ? metrics.shortTermPercentChange >= MOMENTUM_CONTINUATION_SHORT_MIN_PCT
      : metrics.shortTermPercentChange <= -MOMENTUM_CONTINUATION_SHORT_MIN_PCT;
  if (!shortAgrees) return null;

  const relativeStrengthSupports =
    direction === "up" ? metrics.relativeStrength >= RELATIVE_STRENGTH_SUPPORT_PCT : metrics.relativeStrength <= -RELATIVE_STRENGTH_SUPPORT_PCT;
  if (!relativeStrengthSupports) return null;

  if (metrics.volatilityPct >= VOLATILITY_MAX_PCT) return null;

  return {
    strategyType: "MOMENTUM_CONTINUATION",
    direction,
    supportingSignals: [
      `24h momentum ${direction} (${metrics.dailyPercentChange}%)`,
      `short-term (~2h) still moving the same direction (${metrics.shortTermPercentChange}%)`,
      `relative strength vs. BTC supports it (${metrics.relativeStrength}%)`,
    ],
    contradictingSignals: [],
    entryConditions: [
      `short-term price action stays ${direction === "up" ? "positive" : "negative"}`,
      `relative strength vs. BTC stays ${direction === "up" ? "above" : "below"} ${direction === "up" ? "+" : "-"}${RELATIVE_STRENGTH_SUPPORT_PCT}%`,
      `volatility stays below ${VOLATILITY_MAX_PCT}%`,
    ],
    invalidationConditions: [
      `short-term (~2h) window reverses direction`,
      `relative strength vs. BTC no longer supports the move`,
      `volatility reaches ${VOLATILITY_MAX_PCT}% or higher`,
      "source market data becomes stale",
    ],
  };
}

/**
 * RANGE_MEAN_REVERSION (Phase: STRATEGY TYPES #3): the only strategy type
 * gated on the GLOBAL market regime, per the spec's own worked example
 * ("Range regime + contained volatility + weak directional trend"). A
 * symbol can only be a mean-reversion candidate when the overall market
 * (BTC) itself is classified `ranging` — trading range behavior inside a
 * strongly trending or chaotic broad market is a materially different,
 * unmodeled thesis this sprint deliberately does not attempt. Checked last
 * of the three directional/range types, since it explicitly requires the
 * absence of the trend conditions the first two already ruled out.
 */
function evaluateRangeMeanReversion(input: StrategyInput): StrategyEvaluation | null {
  const { metrics, regime } = input;
  if (regime !== "ranging") return null;
  if (metrics.trendConsistency > MEAN_REVERSION_MAX_TREND_CONSISTENCY) return null;
  if (metrics.volatilityPct >= VOLATILITY_MAX_PCT || metrics.volatilityPct < LOW_VOLATILITY_THRESHOLD_PCT) return null;

  return {
    strategyType: "RANGE_MEAN_REVERSION",
    direction: null,
    supportingSignals: [
      "overall market regime is ranging (BTC)",
      `weak directional trend for this symbol (${Math.round(metrics.trendConsistency * 100)}% consistency)`,
      `contained volatility (${metrics.volatilityPct}%)`,
    ],
    contradictingSignals: [],
    entryConditions: [
      "overall market regime stays ranging",
      `trend consistency stays at or below ${MEAN_REVERSION_MAX_TREND_CONSISTENCY}`,
      `volatility stays between ${LOW_VOLATILITY_THRESHOLD_PCT}% and ${VOLATILITY_MAX_PCT}%`,
    ],
    invalidationConditions: [
      "overall market regime shifts away from ranging",
      `trend consistency rises above ${MEAN_REVERSION_MAX_TREND_CONSISTENCY} (a real breakout, not noise)`,
      `volatility moves outside the ${LOW_VOLATILITY_THRESHOLD_PCT}%-${VOLATILITY_MAX_PCT}% band`,
      "source market data becomes stale",
    ],
  };
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const clampScore = (x: number): number => Math.max(0, Math.min(100, Math.round(x)));

/** Trend-following: magnitude+consistency component (up to 40) + momentum-agreement component (up to 30, scaled against the same 15%-move reference `computeOpportunityScore` uses) − volatility penalty (up to 20). */
const TREND_MAGNITUDE_MAX = 40;
const TREND_MAGNITUDE_REFERENCE_PCT = 10;
const TREND_MOMENTUM_AGREEMENT_MAX = 30;
const TREND_MOMENTUM_REFERENCE_PCT = 15;

/** Momentum-continuation: 24h momentum component (up to 40) + short-term confirmation component (up to 20) + relative-strength component (up to 20, matching `computeOpportunityScore`'s own 10%-reference) − volatility penalty (up to 20). */
const MOMENTUM_DAILY_MAX = 40;
const MOMENTUM_DAILY_REFERENCE_PCT = 10;
const MOMENTUM_SHORT_MAX = 20;
const MOMENTUM_SHORT_REFERENCE_PCT = 5;
const MOMENTUM_RELATIVE_STRENGTH_MAX = 20;
const MOMENTUM_RELATIVE_STRENGTH_REFERENCE_PCT = 10;

/** Range/mean-reversion: flat base (a qualifying range setup is inherently lower-conviction than a directional one) + a tightness bonus (up to 20, higher when trend consistency sits further below the ranging ceiling) − volatility penalty (up to 20). */
const RANGE_SCORE_BASE = 45;
const RANGE_TIGHTNESS_BONUS_MAX = 20;

const VOLATILITY_PENALTY_MAX = 20;

/**
 * Deterministic strategy score (Phase: SCORING). Reuses the already-
 * computed, already-audited `Opportunity.score` directly when this
 * symbol has a live market Opportunity — never recomputing an equivalent
 * number under a different name for the same evidence. Only when no
 * Opportunity exists (RANGE_MEAN_REVERSION never has one, by design — see
 * `evaluateRangeMeanReversion`'s own doc comment — and some
 * TREND_FOLLOWING/MOMENTUM_CONTINUATION candidates won't either, since
 * their eligibility bars are independent from `evaluateMarketOpportunityEligibility`'s
 * own 5-condition AND-gate) does this compute its own minimal, additive,
 * capped formula from the same underlying metrics — each contribution
 * independently bounded, exactly like `computeOpportunityScore`'s own
 * "transparent, never a weighted average" discipline.
 */
export function computeStrategyScore(input: StrategyInput, evaluation: StrategyEvaluation): number {
  if (input.opportunity) return input.opportunity.score;

  const { metrics } = input;
  const volatilityPenalty = Math.round(VOLATILITY_PENALTY_MAX * clamp01(metrics.volatilityPct / VOLATILITY_MAX_PCT));

  if (evaluation.strategyType === "TREND_FOLLOWING") {
    const magnitudeComponent = Math.round(TREND_MAGNITUDE_MAX * clamp01(Math.abs(metrics.mediumPercentChange) / TREND_MAGNITUDE_REFERENCE_PCT) * metrics.trendConsistency);
    const momentumComponent = Math.round(TREND_MOMENTUM_AGREEMENT_MAX * clamp01(Math.abs(metrics.dailyPercentChange) / TREND_MOMENTUM_REFERENCE_PCT));
    return clampScore(magnitudeComponent + momentumComponent - volatilityPenalty);
  }
  if (evaluation.strategyType === "MOMENTUM_CONTINUATION") {
    const dailyComponent = Math.round(MOMENTUM_DAILY_MAX * clamp01(Math.abs(metrics.dailyPercentChange) / MOMENTUM_DAILY_REFERENCE_PCT));
    const shortComponent = Math.round(MOMENTUM_SHORT_MAX * clamp01(Math.abs(metrics.shortTermPercentChange) / MOMENTUM_SHORT_REFERENCE_PCT));
    const relativeStrengthComponent = Math.round(
      MOMENTUM_RELATIVE_STRENGTH_MAX * clamp01(Math.abs(metrics.relativeStrength) / MOMENTUM_RELATIVE_STRENGTH_REFERENCE_PCT),
    );
    return clampScore(dailyComponent + shortComponent + relativeStrengthComponent - volatilityPenalty);
  }
  if (evaluation.strategyType === "RANGE_MEAN_REVERSION") {
    const tightnessBonus = Math.round(
      RANGE_TIGHTNESS_BONUS_MAX * clamp01((MEAN_REVERSION_MAX_TREND_CONSISTENCY - metrics.trendConsistency) / MEAN_REVERSION_MAX_TREND_CONSISTENCY),
    );
    return clampScore(RANGE_SCORE_BASE + tightnessBonus - volatilityPenalty);
  }
  return 0;
}

/**
 * Deterministic strategy confidence (Phase: STRATEGY OUTPUT). Reuses
 * `Opportunity.confidence` when one exists, for the identical reason
 * `computeStrategyScore` does. Otherwise computed as an evidence-margin
 * average against this strategy type's own eligibility thresholds — the
 * same style `computeMarketConfidence` already established — mapped onto a
 * slightly more conservative [60, 90] range than an Opportunity's [70, 95]:
 * a strategy candidate is one derivative step further from raw evidence
 * (it can fire without ever having cleared Sprint 14's own stricter
 * 5-condition Opportunity gate), so its ceiling is intentionally lower.
 */
export function computeStrategyConfidence(input: StrategyInput, evaluation: StrategyEvaluation): number {
  if (input.opportunity) return input.opportunity.confidence;

  const { metrics } = input;
  if (evaluation.strategyType === "TREND_FOLLOWING") {
    const margins = [
      (Math.abs(metrics.mediumPercentChange) - TREND_MIN_PCT) / TREND_MIN_PCT,
      (metrics.trendConsistency - TREND_MIN_CONSISTENCY) / (1 - TREND_MIN_CONSISTENCY),
    ].map(clamp01);
    const avg = margins.reduce((s, v) => s + v, 0) / margins.length;
    return Math.round(60 + 30 * avg);
  }
  if (evaluation.strategyType === "MOMENTUM_CONTINUATION") {
    const margins = [
      (Math.abs(metrics.dailyPercentChange) - MOMENTUM_MIN_PCT) / MOMENTUM_MIN_PCT,
      (Math.abs(metrics.shortTermPercentChange) - MOMENTUM_CONTINUATION_SHORT_MIN_PCT) / MOMENTUM_CONTINUATION_SHORT_MIN_PCT,
    ].map(clamp01);
    const avg = margins.reduce((s, v) => s + v, 0) / margins.length;
    return Math.round(60 + 30 * avg);
  }
  if (evaluation.strategyType === "RANGE_MEAN_REVERSION") {
    const margin = clamp01((MEAN_REVERSION_MAX_TREND_CONSISTENCY - metrics.trendConsistency) / MEAN_REVERSION_MAX_TREND_CONSISTENCY);
    return Math.round(60 + 25 * margin);
  }
  return 0;
}

/** Flat, documented classification confidence for a `NO_TRADE` conclusion — matching `market_regime`'s own flat `REGIME_CONFIDENCE` precedent for bucket classifications: there is no thesis to be confident ABOUT, only a reliable "no valid deterministic pattern" determination. */
const NO_TRADE_CONFIDENCE = 80;

/**
 * The full deterministic pipeline (Phase: STRATEGY SELECTION): staleness
 * and risk gates first (both hard vetoes regardless of any evidence),
 * then the three strategy types in a fixed priority order
 * (TREND_FOLLOWING > MOMENTUM_CONTINUATION > RANGE_MEAN_REVERSION, most
 * demanding evidence first), falling back to `NO_TRADE` with an explicit,
 * always-present reason when nothing qualifies. Pure function of already-
 * persisted inputs — identical inputs always produce an identical
 * candidate (Phase: IDEMPOTENCY / DETERMINISM).
 */
export function selectStrategy(input: StrategyInput, now: number = Date.now()): StrategyCandidate {
  const { metrics, regime, opportunity, risk } = input;

  const buildNoTrade = (reason: NoTradeReason, contradictingSignals: string[]): StrategyCandidate => ({
    symbol: metrics.symbol,
    strategyType: "NO_TRADE",
    strategyVersion: STRATEGY_VERSION,
    direction: null,
    score: 0,
    confidence: NO_TRADE_CONFIDENCE,
    marketRegime: regime,
    supportingSignals: [],
    contradictingSignals,
    thesis: `No deterministic strategy pattern currently applies to ${metrics.symbol}.`,
    entryConditions: [],
    invalidationConditions: [],
    riskConditions: risk ? [`open ${risk.severity}-severity market risk`] : [],
    expectedScenario: "Hypothetical: no position is warranted by current evidence; re-evaluated next run.",
    noTradeReason: reason,
    riskUnit: 0,
    sourceOpportunityId: opportunity?.id ?? null,
    sourceRiskId: risk?.id ?? null,
    observedAt: metrics.observedAt,
  });

  if (isStale(metrics.observedAt, now)) {
    return buildNoTrade("stale_data", [`market data last observed ${metrics.observedAt}, older than ${STALE_DATA_MAX_AGE_MS / 3_600_000}h`]);
  }

  if (risk && UNACCEPTABLE_RISK_SEVERITIES.has(risk.severity)) {
    return buildNoTrade("unacceptable_risk", [`open ${risk.severity}-severity market risk overrides any opportunity evidence`]);
  }

  // Reuses Sprint 14's own already-computed `conflicting_signals` risk
  // condition (never recomputed here) -- even at `medium` severity (so it
  // doesn't already trip the veto above), a symbol whose daily move and
  // relative strength disagree is not a sound basis for ANY directional
  // thesis, so this is checked as its own explicit NO_TRADE reason rather
  // than folded into the generic "insufficient evidence" fallback.
  if (risk?.conditions.includes("conflicting_signals")) {
    return buildNoTrade("conflicting_signals", ["daily move and relative strength vs. BTC disagree in direction (Sprint 14's own conflicting_signals risk condition)"]);
  }

  const evaluation = evaluateTrendFollowing(input) ?? evaluateMomentumContinuation(input) ?? evaluateRangeMeanReversion(input);

  if (!evaluation) {
    return buildNoTrade("insufficient_evidence", ["no directional trend, no continuing momentum, and no qualifying range condition"]);
  }

  const score = computeStrategyScore(input, evaluation);
  const confidence = computeStrategyConfidence(input, evaluation);
  const contradictingSignals = [...evaluation.contradictingSignals];
  if (risk) contradictingSignals.push(`open ${risk.severity}-severity market risk (not severe enough to veto, but weighs against the thesis)`);

  const riskConditions = risk
    ? [`open ${risk.severity}-severity market risk`, ...evaluation.invalidationConditions]
    : evaluation.invalidationConditions;

  return {
    symbol: metrics.symbol,
    strategyType: evaluation.strategyType,
    strategyVersion: STRATEGY_VERSION,
    direction: evaluation.direction,
    score,
    confidence,
    marketRegime: regime,
    supportingSignals: evaluation.supportingSignals,
    contradictingSignals,
    thesis: buildThesis(metrics.symbol, evaluation, confidence, regime),
    entryConditions: evaluation.entryConditions,
    invalidationConditions: evaluation.invalidationConditions,
    riskConditions,
    expectedScenario: buildExpectedScenario(evaluation),
    noTradeReason: null,
    riskUnit: 1,
    sourceOpportunityId: opportunity?.id ?? null,
    sourceRiskId: risk?.id ?? null,
    observedAt: metrics.observedAt,
  };
}

function buildThesis(symbol: string, evaluation: StrategyEvaluation, confidence: number, regime: string | null): string {
  const regimeNote = regime ? ` Market regime: ${regime}.` : "";
  return `${symbol} — ${evaluation.strategyType} (confidence ${confidence}).${regimeNote} ${evaluation.supportingSignals.join("; ")}.`;
}

/**
 * Explicitly hypothetical, never a computed dollar/ROI figure (Phase:
 * STRATEGY OUTPUT — "NO ROI FABRICATION"). `riskUnit: 1` is a normalized,
 * dimensionless sizing placeholder only — there is no account/position
 * data anywhere in this pipeline to size a real position against.
 */
function buildExpectedScenario(evaluation: StrategyEvaluation): string {
  const directionLabel = evaluation.direction === "up" ? "continued upside" : evaluation.direction === "down" ? "continued downside" : "reversion toward the recent range's mean";
  return (
    `Hypothetical scenario only, at riskUnit = 1 (a normalized, dimensionless sizing unit — no account balance, ` +
    `equity, leverage, or real position size is known or assumed): if current conditions hold, the thesis expects ${directionLabel}. ` +
    `Not a prediction, not a guarantee, and not tied to any dollar amount.`
  );
}
