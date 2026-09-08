import type { OutcomeType } from "@prisma/client";

export type RecordLearningInput = {
  organizationId: string;
  outcomeId: string;
  relatedEntityType: string;
  relatedEntityId: string;
  ruleName: string;
  ruleVersion: string;
  outcomeType: OutcomeType;
  decisionId?: string;
  autonomousActionLogId?: string;
  expectedValue?: number;
  observedValue?: number;
  evaluationConfidence: number;
};

export type PerformanceFilter = {
  organizationId: string;
  ruleName?: string;
  /** Only meaningful together with `ruleName` -- narrows to one rule version, e.g. "v1". */
  ruleVersion?: string;
  relatedEntityType?: string;
  requireDecisionLink?: boolean;
};

export type OutcomePerformance = {
  totalEvaluated: number;
  successCount: number;
  failureCount: number;
  neutralCount: number;
  expiredCount: number;
  reversedCount: number;
  unknownCount: number;
  pendingCount: number;
  insufficientEvidenceCount: number;
  successRate: number | null;
  averageConfidence: number | null;
  averageTimeToOutcomeMs: number | null;
};

export type AutonomousActionPerformance = {
  totalExecuted: number;
  outcomesTracked: number;
  pendingCount: number;
  evaluatedCount: number;
  successCount: number;
  reversedCount: number;
  otherCount: number;
  successRate: number | null;
  reversalRate: number | null;
};

export type ConfidenceBucket = {
  label: string;
  min: number;
  max: number;
  totalEvaluated: number;
  successCount: number;
  observedSuccessRate: number | null;
};
