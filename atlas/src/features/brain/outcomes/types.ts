import type { Evidence } from "../trust/types";

/** Full lifecycle states for a recommendation */
export const DECISION_LIFECYCLE = [
  "PROPOSED",
  "ACCEPTED",
  "REJECTED",
  "IGNORED",
  "EXECUTED",
  "COMPLETED",
  "SUCCESSFUL",
  "FAILED",
  "UNKNOWN",
] as const;

export type DecisionLifecycleState = (typeof DECISION_LIFECYCLE)[number];

/** Valid transitions — prevents illegal state jumps */
export const VALID_TRANSITIONS: Record<string, readonly string[]> = {
  PROPOSED: ["ACCEPTED", "REJECTED", "IGNORED"],
  ACCEPTED: ["EXECUTED", "REJECTED"],
  REJECTED: [],
  IGNORED: ["ACCEPTED"],
  EXECUTED: ["COMPLETED", "FAILED", "UNKNOWN"],
  COMPLETED: ["SUCCESSFUL", "FAILED", "UNKNOWN"],
  SUCCESSFUL: [],
  FAILED: [],
  UNKNOWN: ["SUCCESSFUL", "FAILED"],
};

/** Result of an outcome evaluation */
export interface OutcomeEvaluationResult {
  result: "SUCCESS" | "FAILURE" | "PARTIAL_SUCCESS" | "NO_OUTCOME_YET";
  outcomeScore: number;
  confidence: number;
  explanation: string;
  evidence: Evidence[];
}

/** Recommendation analytics metrics */
export interface RecommendationMetrics {
  totalRecommendations: number;
  acceptanceRate: number;
  successRate: number;
  failureRate: number;
  avgTimeToCompletionHours: number;
  avgPriorityScore: number;
  byCategory: Record<string, { count: number; successRate: number }>;
}

/** A single record in recommendation history */
export interface RecommendationHistoryEntry {
  decisionId: string;
  problemStatement: string;
  recommendedDecision: string;
  status: string;
  priorityScore: number;
  confidenceScore: number;
  outcomeScore: number | null;
  createdAt: string;
  resolvedAt: string | null;
}
