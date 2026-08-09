/*
 * Type-safe Prisma enum validators.
 *
 * Every string-to-enum conversion goes through these functions.
 * Invalid values return null or an explicit safe fallback.
 */

function isEnumValue<const TValues extends readonly string[]>(
  values: TValues,
  value: string
): value is TValues[number] {
  return values.includes(value);
}

// =============================================================================
// Action enums
// =============================================================================

const ACTION_TYPES = [
  "EMAIL_DRAFT",
  "TASK",
  "CALENDAR_PROPOSAL",
  "FOLLOW_UP",
] as const;
type ActionType = (typeof ACTION_TYPES)[number];

export function toActionType(value: string): ActionType | null {
  return isEnumValue(ACTION_TYPES, value) ? value : null;
}

const ACTION_STATUSES = ["PENDING", "APPROVED", "DISMISSED"] as const;
type ActionStatus = (typeof ACTION_STATUSES)[number];

export function toActionStatus(value: string): ActionStatus | null {
  return isEnumValue(ACTION_STATUSES, value) ? value : null;
}

// =============================================================================
// Decision enums
// =============================================================================

const DECISION_STATUSES = [
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
type DecisionStatus = (typeof DECISION_STATUSES)[number];

export function toDecisionStatus(value: string): DecisionStatus | null {
  return isEnumValue(DECISION_STATUSES, value) ? value : null;
}

const TIMELINE_EVENT_TYPES = [
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
] as const;
type TimelineEventType = (typeof TIMELINE_EVENT_TYPES)[number];

export function toTimelineEventType(value: string): TimelineEventType {
  return isEnumValue(TIMELINE_EVENT_TYPES, value) ? value : "OUTCOME_RECORDED";
}

// =============================================================================
// Insight enums
// =============================================================================

const INSIGHT_CATEGORIES = [
  "STRATEGIC",
  "OPERATIONAL",
  "TEAM",
  "FINANCIAL",
  "RISK",
] as const;
type InsightCategory = (typeof INSIGHT_CATEGORIES)[number];

export function toInsightCategory(value: string): InsightCategory | null {
  return isEnumValue(INSIGHT_CATEGORIES, value) ? value : null;
}

const INSIGHT_SEVERITIES = [
  "INFO",
  "SUGGESTION",
  "WARNING",
  "CRITICAL",
] as const;
type InsightSeverity = (typeof INSIGHT_SEVERITIES)[number];

export function toInsightSeverity(value: string): InsightSeverity | null {
  return isEnumValue(INSIGHT_SEVERITIES, value) ? value : null;
}

const INSIGHT_STATUSES = [
  "NEW",
  "ACKNOWLEDGED",
  "ACTED_ON",
  "DISMISSED",
] as const;
type InsightStatus = (typeof INSIGHT_STATUSES)[number];

export function toInsightStatus(value: string): InsightStatus | null {
  return isEnumValue(INSIGHT_STATUSES, value) ? value : null;
}

// =============================================================================
// Outcome enums
// =============================================================================

const OUTCOME_RESULTS = [
  "SUCCESS",
  "FAILURE",
  "PARTIAL_SUCCESS",
  "NO_OUTCOME_YET",
] as const;
type OutcomeResult = (typeof OUTCOME_RESULTS)[number];

export function toOutcomeResult(value: string): OutcomeResult {
  return isEnumValue(OUTCOME_RESULTS, value) ? value : "NO_OUTCOME_YET";
}

// =============================================================================
// Memory enums
// =============================================================================

const MEMORY_CATEGORIES = [
  "DECISION",
  "PREFERENCE",
  "TEAM_DYNAMIC",
  "PROJECT_STATUS",
  "PROCESS",
  "GOAL",
  "FACT",
] as const;
type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export function toMemoryCategory(value: string): MemoryCategory | null {
  return isEnumValue(MEMORY_CATEGORIES, value) ? value : null;
}
