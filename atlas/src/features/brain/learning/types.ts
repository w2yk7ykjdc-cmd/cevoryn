/** Types of patterns the Learning Engine detects */
export const PATTERN_TYPES = [
  "acceptance",
  "success",
  "failure",
  "repeat",
  "timing",
  /** A persisted confidence-calibration snapshot (see
   *  learning-engine.ts::runLearningCycleForOrganization) - category
   *  distinguishes "decision" from "opportunity" calibration. */
  "calibration",
] as const;

export type PatternType = (typeof PATTERN_TYPES)[number];

/** A learned pattern with confidence and evidence */
export interface LearnedPattern {
  id: string;
  patternType: PatternType;
  category: string;
  pattern: string;
  frequency: number;
  confidence: number;
  createdAt: string;
}

/** Analytics for recommendation quality over time */
export interface LearningAnalytics {
  totalDecisions: number;
  acceptanceRate: number;
  successRate: number;
  failureRate: number;
  avgOutcomeScore: number;
  avgTimeToCompletionHours: number;
  avgConfidenceScore: number;
  calibrationDelta: number;
  patterns: LearnedPattern[];
}

/** Confidence calibration data */
export interface CalibrationData {
  predictedConfidence: number;
  actualOutcomeScore: number;
  delta: number;
  category: string;
}

/**
 * Same shape as CalibrationData, kept as a distinct type rather than a
 * reused alias: Opportunity calibration compares a structurally different
 * "predicted confidence" (Opportunity.confidence, an event-extraction
 * confidence score) against the same outcomeScore metric Decision
 * calibration uses - the two must never be pooled into one dataset, only
 * ever computed and reported separately. See
 * confidence-calibrator.ts::computeOpportunityCalibration.
 */
export interface OpportunityCalibrationData {
  predictedConfidence: number;
  actualOutcomeScore: number;
  delta: number;
  /** Opportunity.polarity ("OPPORTUNITY" | "THREAT") - the natural
   *  segmentation for this domain, unlike Decision's problem-statement
   *  word category. */
  category: string;
}

/** Result shape shared by computeCalibration and computeOpportunityCalibration. */
export interface CalibrationResult<T> {
  adjustmentFactor: number;
  dataPoints: T[];
  isCalibrated: boolean;
}
