/** Types of patterns the Learning Engine detects */
export const PATTERN_TYPES = [
  "acceptance",
  "success",
  "failure",
  "repeat",
  "timing",
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
