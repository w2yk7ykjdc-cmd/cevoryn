import type { SampleSizeStatus } from "@/server/intelligence/decision-intelligence/types";

/**
 * Below this many evaluated outcomes, a raw success rate is flagged
 * `insufficient_sample` in the ranking explanation -- 1 success out of 1
 * evaluated outcome is NOT "100% reliable." This is purely an explanatory
 * label surfaced to a human/AI reader; `shrinkSuccessRate` below is what
 * actually protects the ranking math itself from small-sample noise, and it
 * applies at every sample size, not just below this threshold.
 */
export const MIN_SAMPLE_SIZE = 5;

/**
 * Equivalent to this many "pretend" neutral observations pulling a small
 * real sample back toward the neutral prior. As `totalEvaluated` grows, the
 * prior's influence shrinks proportionally (at `totalEvaluated = 45`, for
 * example, 5 pretend observations move the result by under 10%).
 */
const PRIOR_WEIGHT = 5;

/** Neutral prior success rate (percent) -- "we don't know yet," not "it works" or "it fails." */
const PRIOR_SUCCESS_RATE = 50;

/**
 * Deterministic Bayesian/Laplace shrinkage of a success rate toward a
 * neutral 50% prior -- NOT a statistics library, NOT ML, just one line of
 * arithmetic (`(successCount + k*prior) / (totalEvaluated + k)`), per
 * Sprint 12's explicit mandate to avoid both. A candidate type with 1
 * success out of 1 evaluated outcome shrinks to ~58%, not 100%; with 0
 * evaluated outcomes it returns exactly the neutral 50% prior. As real
 * evidence accumulates, the shrunk rate converges on the true observed
 * rate. See `ranking.ts` for how this feeds `historicalFactor` -- always as
 * a bounded multiplier on top of the base severity-weighted score, never as
 * a standalone verdict (Sprint 12 rule #9: historical performance must
 * never become truth).
 */
export function shrinkSuccessRate(successCount: number, totalEvaluated: number): number {
  const shrunk = ((successCount + PRIOR_WEIGHT * (PRIOR_SUCCESS_RATE / 100)) / (totalEvaluated + PRIOR_WEIGHT)) * 100;
  return Math.round(shrunk * 100) / 100;
}

export function sampleSizeStatusFor(totalEvaluated: number): SampleSizeStatus {
  return totalEvaluated < MIN_SAMPLE_SIZE ? "insufficient_sample" : "sufficient_sample";
}
