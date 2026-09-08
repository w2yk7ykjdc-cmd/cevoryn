import type { OutcomePerformance } from "@/server/intelligence/learning/types";

/**
 * The only two subject types a live `DecisionCandidate` (Sprint 8's
 * `RiskCandidate | OpportunityCandidate` union) can ever be -- and,
 * consequently, the only two `Outcome.relatedEntityType` values this
 * module reads historical performance for. NOT the same concept as
 * `Outcome.ruleName` (the evaluation rule, e.g. `risk_resolution`) -- see
 * `performance.ts`'s doc comment for why these two dimensions are kept
 * deliberately distinct rather than collapsed into one.
 */
export const CANDIDATE_RELATED_ENTITY_TYPES = ["Opportunity", "Risk"] as const;
export type CandidateRelatedEntityType = (typeof CANDIDATE_RELATED_ENTITY_TYPES)[number];

export type SampleSizeStatus = "insufficient_sample" | "sufficient_sample";

/** `OutcomePerformance` plus the sample-size-safe view of `successRate` -- see `sample-safety.ts`. */
export type ShrunkPerformance = OutcomePerformance & {
  /** `successRate` shrunk toward a neutral 50% prior; always defined (0-100), never `null`. */
  shrunkSuccessRate: number;
  sampleSizeStatus: SampleSizeStatus;
};

export type CandidateTypePerformance = {
  relatedEntityType: CandidateRelatedEntityType;
  performance: ShrunkPerformance;
};

export type RulePerformanceEntry = {
  ruleName: string;
  ruleVersion: string;
  performance: OutcomePerformance;
};

export type RankedDecisionCandidate = {
  kind: "risk" | "opportunity";
  id: string;
  title: string;
  /** Sprint 8's original severity-weighted dollar-exposure score, unchanged. */
  baseScore: number;
  /** [0.5, 1.0] -- how much this candidate's own recorded confidence scales `baseScore`. */
  confidenceFactor: number;
  /** [0.5, 1.0] -- how much this candidate type's shrinkage-adjusted historical success rate scales `baseScore`. */
  historicalFactor: number;
  /** `baseScore * (confidenceFactor + historicalFactor) / 2` -- the final ranking key. */
  priorityScore: number;
  /** Deterministic, DB-derived explanation strings. Never LLM-generated. */
  rankingReasons: string[];
};
