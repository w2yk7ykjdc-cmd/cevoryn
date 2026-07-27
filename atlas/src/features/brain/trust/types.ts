/**
 * Trust Engine Types
 *
 * Every recommendation CEVORYN makes MUST be wrapped in a TrustEnvelope.
 * This enforces transparency: the user always sees WHY something is recommended,
 * HOW confident CEVORYN is, and WHAT information is missing.
 *
 * CEVORYN must NEVER present uncertain conclusions as facts.
 */

/** A piece of supporting evidence for a recommendation */
export interface Evidence {
  source: "conversation" | "memory" | "pulse" | "insight" | "activity";
  sourceId: string;
  excerpt: string;
  timestamp: string;
  weight: number;
}

/**
 * Every AI-generated recommendation is wrapped in this envelope.
 * The UI must always display confidence and reasoning alongside the data.
 */
export interface TrustEnvelope<T> {
  data: T;
  confidence: number;
  reasoning: string;
  evidence: Evidence[];
  missingInformation: string[];
  alternativeExplanations: string[];
  dataFreshness: string;
}

/** Confidence thresholds for UI display */
export const CONFIDENCE_LEVELS = {
  HIGH: 0.8,
  MEDIUM: 0.5,
  LOW: 0.3,
} as const;

export type ConfidenceLevel = "high" | "medium" | "low" | "insufficient";

export function getConfidenceLevel(score: number): ConfidenceLevel {
  if (score >= CONFIDENCE_LEVELS.HIGH) return "high";
  if (score >= CONFIDENCE_LEVELS.MEDIUM) return "medium";
  if (score >= CONFIDENCE_LEVELS.LOW) return "low";
  return "insufficient";
}
