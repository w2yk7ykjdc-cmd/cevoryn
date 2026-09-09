/**
 * Sprint 19's own deterministic thresholds, named and documented (matching
 * the discipline `paper-trading/constants.ts` already established: "every
 * threshold/formula gets a name and a reason, never a bare magic number").
 * Every value here is an explicit, labeled SIMULATION/READINESS input --
 * none of it is inferred from a real account or a real execution history.
 */

/**
 * How long a computed `ProposedOrder` remains valid before it must be
 * treated as stale and recomputed against fresh data. A decision is always
 * computed and validated against LIVE data in this sprint (there is no
 * caching layer that could serve a decision-derived proposal after this
 * window elapses), so `expired_decision` structurally never fires on the
 * real, live read path -- it exists so the validation function itself is a
 * real, independently testable capability (Sprint 19 Phase 5's own
 * `expired_decision` reason), not a a dead branch. 15 minutes matches the
 * cadence a human or an AI tool call would reasonably re-check market
 * intelligence at, well inside the hourly pipeline cadence every upstream
 * stage (ingest/intelligence/strategy/paper-trading) already runs at.
 */
export const DECISION_VALIDITY_MS = 15 * 60 * 1000;

/**
 * Sprint 19 Phase 3's own, STRICTER execution-level risk bar than the
 * strategy layer's (`strategy/scoring.ts#UNACCEPTABLE_RISK_SEVERITIES`,
 * which only vetoes `high`/`critical`). A `medium`-severity market risk is
 * tolerable evidence for a strategy CANDIDATE to exist (Sprint 15 already
 * allows it, as a contradicting signal that lowers confidence rather than
 * a veto) but is deliberately NOT tolerable for actually proposing an
 * order that could, in the future, risk real capital -- "ready for real
 * execution" is a higher bar than "worth forming a thesis about."
 */
export const EXECUTION_UNACCEPTABLE_RISK_SEVERITIES = new Set(["medium", "high", "critical"]);

/**
 * If a strategy type's CURRENT opportunity score is at or above this while
 * its OWN historical `StrategyEvaluation.evaluationScore` is at or below
 * `CONFLICTING_EVALUATION_SCORE_MAX` (with sufficient evidence to trust
 * that historical score at all), current evidence and historical evidence
 * genuinely disagree -- a real, measured `conflicting_signal`, never
 * fabricated. Both thresholds intentionally sit on opposite ends of their
 * own [0,100] scales (a "clearly good now" vs. "clearly bad historically"
 * contradiction), not an arbitrary midpoint split.
 */
export const CONFLICTING_HIGH_OPPORTUNITY_SCORE_MIN = 70;
export const CONFLICTING_LOW_EVALUATION_SCORE_MAX = 30;

/**
 * Portfolio-level (account) drawdown ceiling for allowing a NEW entry,
 * reusing `PaperAccount.drawdownPct` (already computed, Sprint 16) rather
 * than a second drawdown calculation. Deliberately distinct from Sprint
 * 18's per-strategy `maxDrawdownPct` (a different denominator/subject) --
 * see `service.ts#validateProposedOrder`'s own doc comment. 25% is a
 * conservative, documented circuit breaker: an account that has already
 * given back a quarter of its peak equity should stop opening NEW risk
 * until it recovers, exactly the same "risk management doesn't stop
 * existing positions, it stops NEW ones" principle the kill switch itself
 * applies.
 */
export const MAX_ACCOUNT_DRAWDOWN_PCT_FOR_ENTRY = 25;
