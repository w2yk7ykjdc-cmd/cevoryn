import type { OpportunityScoreBreakdown } from "../types";

/**
 * Pure, deterministic scoring formula - the weights and combination are
 * fixed code, not an LLM judgment, so the score is reproducible and
 * testable. The five input dimensions themselves come from the LLM's
 * structured judgment in opportunity-generator.ts (mirroring how Decision
 * Canvas's confidenceScore already works) - what's deterministic here is
 * how they combine into one number, which is what "explainable" actually
 * requires: the user can see exactly which dimension drove the score.
 */
const WEIGHTS: OpportunityScoreBreakdown = {
  relevance: 0.3,
  strategicFit: 0.25,
  economicPotential: 0.25,
  timing: 0.1,
  confidence: 0.1,
};

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function scoreOpportunity(inputs: OpportunityScoreBreakdown): {
  score: number;
  breakdown: OpportunityScoreBreakdown;
} {
  const breakdown: OpportunityScoreBreakdown = {
    relevance: clamp01(inputs.relevance),
    strategicFit: clamp01(inputs.strategicFit),
    economicPotential: clamp01(inputs.economicPotential),
    timing: clamp01(inputs.timing),
    confidence: clamp01(inputs.confidence),
  };

  const rawScore =
    breakdown.relevance * WEIGHTS.relevance +
    breakdown.strategicFit * WEIGHTS.strategicFit +
    breakdown.economicPotential * WEIGHTS.economicPotential +
    breakdown.timing * WEIGHTS.timing +
    breakdown.confidence * WEIGHTS.confidence;

  return { score: Math.round(rawScore * 100) / 100, breakdown };
}

/** 1 (highest) to 10 (lowest), matching PreparedAction/Insight's existing priority convention. */
export function scoreToPriority(score: number): number {
  const clamped = clamp01(score);
  return Math.max(1, Math.min(10, 10 - Math.round(clamped * 9)));
}
