import type { OutcomeEvaluationStatus, OutcomeSource, OutcomeType } from "@prisma/client";

export type { OutcomeEvaluationStatus, OutcomeSource, OutcomeType };

export type ListOutcomesInput = {
  organizationId: string;
  evaluationStatus?: OutcomeEvaluationStatus;
  relatedEntityType?: string;
  limit?: number;
  cursor?: string;
};

export class OutcomePermissionError extends Error {
  constructor(action: string) {
    super(`Missing permission to ${action} an outcome`);
    this.name = "OutcomePermissionError";
  }
}

export class OutcomeNotFoundError extends Error {
  constructor(outcomeId: string) {
    super(`Outcome "${outcomeId}" not found`);
    this.name = "OutcomeNotFoundError";
  }
}

/**
 * The minimum a rule module needs to open a new, pending `Outcome` row for
 * a subject it just discovered. `evidence` is the rule's own initial
 * snapshot (e.g. an expected dollar value that must not later drift with
 * the live source record) — see `Outcome`'s and `LearningRecord`'s schema
 * doc comments for why this is captured now rather than at evaluation time.
 */
export type CreatePendingOutcomeInput = {
  organizationId: string;
  relatedEntityType: string;
  relatedEntityId: string;
  ruleName: string;
  ruleVersion: string;
  autonomousActionLogId?: string;
  decisionId?: string;
  signalId?: string;
  observationDueAt: Date;
  evidence?: Record<string, unknown>;
};

/**
 * What a rule's deterministic evaluation concluded for one previously
 * `pending` `Outcome` row. `source` is always `"system"` here — a rule
 * never writes `"human"`; that only ever comes from `confirmOutcome`, and
 * once a row is human-sourced the evaluation job skips it permanently (the
 * same "never overwrite a human's own triage decision" invariant already
 * established for `Opportunity`/`Risk`).
 */
export type ApplyEvaluationInput = {
  outcomeId: string;
  organizationId: string;
  outcomeType: OutcomeType;
  confidence: number;
  evidence?: Record<string, unknown>;
  value?: number;
  currency?: string;
  expectedValue?: number;
  observedValue?: number;
};

export type MarkInsufficientEvidenceInput = {
  outcomeId: string;
  organizationId: string;
  evidence?: Record<string, unknown>;
};

export type ConfirmOutcomeInput = {
  organizationId: string;
  outcomeId: string;
  outcomeType: OutcomeType;
  confirmedById: string;
  requestHeaders: Headers;
  note?: string;
};
