/**
 * Type-safe Prisma enum validators.
 *
 * Every string→enum conversion goes through these functions.
 * Invalid values throw or return a safe default instead of silent 'as any' casts.
 */

// =============================================================================
// Action enums
// =============================================================================

const ACTION_TYPES = new Set([
  "EMAIL_DRAFT",
  "TASK",
  "CALENDAR_PROPOSAL",
  "FOLLOW_UP",
] as const);
type ActionType = "EMAIL_DRAFT" | "TASK" | "CALENDAR_PROPOSAL" | "FOLLOW_UP";

export function toActionType(value: string): ActionType | null {
  return ACTION_TYPES.has(value as ActionType) ? (value as ActionType) : null;
}

const ACTION_STATUSES = new Set(["PENDING", "APPROVED", "DISMISSED"] as const);
type ActionStatus = "PENDING" | "APPROVED" | "DISMISSED";

export function toActionStatus(value: string): ActionStatus | null {
  return ACTION_STATUSES.has(value as ActionStatus)
    ? (value as ActionStatus)
    : null;
}

// =============================================================================
// Decision enums
// =============================================================================

const DECISION_STATUSES = new Set([
  "PROPOSED",
  "ACCEPTED",
  "REJECTED",
  "IGNORED",
  "EXECUTED",
  "COMPLETED",
  "SUCCESSFUL",
  "FAILED",
  "UNKNOWN",
] as const);
type DecisionStatus =
  | "PROPOSED"
  | "ACCEPTED"
  | "REJECTED"
  | "IGNORED"
  | "EXECUTED"
  | "COMPLETED"
  | "SUCCESSFUL"
  | "FAILED"
  | "UNKNOWN";

export function toDecisionStatus(value: string): DecisionStatus | null {
  return DECISION_STATUSES.has(value as DecisionStatus)
    ? (value as DecisionStatus)
    : null;
}

const TIMELINE_EVENT_TYPES = new Set([
  "PROBLEM_DETECTED",
  "CANVAS_GENERATED",
  "RECOMMENDATION_MADE",
  "USER_ACCEPTED",
  "USER_REJECTED",
  "USER_IGNORED",
  "EXECUTION_STARTED",
  "OUTCOME_RECORDED",
  "OUTCOME_EVALUATED",
  "LEARNING_EXTRACTED",
  "FOLLOW_UP_DUE",
] as const);
type TimelineEventType =
  | "PROBLEM_DETECTED"
  | "CANVAS_GENERATED"
  | "RECOMMENDATION_MADE"
  | "USER_ACCEPTED"
  | "USER_REJECTED"
  | "USER_IGNORED"
  | "EXECUTION_STARTED"
  | "OUTCOME_RECORDED"
  | "OUTCOME_EVALUATED"
  | "LEARNING_EXTRACTED"
  | "FOLLOW_UP_DUE";

export function toTimelineEventType(value: string): TimelineEventType {
  return TIMELINE_EVENT_TYPES.has(value as TimelineEventType)
    ? (value as TimelineEventType)
    : "OUTCOME_RECORDED";
}

// =============================================================================
// Insight enums
// =============================================================================

const INSIGHT_CATEGORIES = new Set([
  "STRATEGIC",
  "OPERATIONAL",
  "TEAM",
  "FINANCIAL",
  "RISK",
] as const);
type InsightCategory =
  "STRATEGIC" | "OPERATIONAL" | "TEAM" | "FINANCIAL" | "RISK";

export function toInsightCategory(value: string): InsightCategory | null {
  return INSIGHT_CATEGORIES.has(value as InsightCategory)
    ? (value as InsightCategory)
    : null;
}

const INSIGHT_SEVERITIES = new Set([
  "INFO",
  "SUGGESTION",
  "WARNING",
  "CRITICAL",
] as const);
type InsightSeverity = "INFO" | "SUGGESTION" | "WARNING" | "CRITICAL";

export function toInsightSeverity(value: string): InsightSeverity | null {
  return INSIGHT_SEVERITIES.has(value as InsightSeverity)
    ? (value as InsightSeverity)
    : null;
}

const INSIGHT_STATUSES = new Set([
  "NEW",
  "ACKNOWLEDGED",
  "ACTED_ON",
  "DISMISSED",
] as const);
type InsightStatus = "NEW" | "ACKNOWLEDGED" | "ACTED_ON" | "DISMISSED";

export function toInsightStatus(value: string): InsightStatus | null {
  return INSIGHT_STATUSES.has(value as InsightStatus)
    ? (value as InsightStatus)
    : null;
}

// =============================================================================
// Outcome enums
// =============================================================================

const OUTCOME_RESULTS = new Set([
  "SUCCESS",
  "FAILURE",
  "PARTIAL_SUCCESS",
  "NO_OUTCOME_YET",
] as const);
type OutcomeResult =
  "SUCCESS" | "FAILURE" | "PARTIAL_SUCCESS" | "NO_OUTCOME_YET";

export function toOutcomeResult(value: string): OutcomeResult {
  return OUTCOME_RESULTS.has(value as OutcomeResult)
    ? (value as OutcomeResult)
    : "NO_OUTCOME_YET";
}

// =============================================================================
// Memory enums
// =============================================================================

const MEMORY_CATEGORIES = new Set([
  "DECISION",
  "PREFERENCE",
  "TEAM_DYNAMIC",
  "PROJECT_STATUS",
  "PROCESS",
  "GOAL",
  "FACT",
] as const);
type MemoryCategory =
  | "DECISION"
  | "PREFERENCE"
  | "TEAM_DYNAMIC"
  | "PROJECT_STATUS"
  | "PROCESS"
  | "GOAL"
  | "FACT";

export function toMemoryCategory(value: string): MemoryCategory | null {
  return MEMORY_CATEGORIES.has(value as MemoryCategory)
    ? (value as MemoryCategory)
    : null;
}
