import type { SignalSeverity, SignalSourceType, SignalStatus } from "@prisma/client";

export type { SignalSeverity, SignalSourceType, SignalStatus };

export type RecordSignalInput = {
  organizationId: string;
  /** Free-form signal identifier, e.g. `"lead.created"` (passthrough) or `"high_value_stalled_lead"` (detected). */
  type: string;
  sourceType: SignalSourceType;
  /**
   * The idempotency-scoping identifier for this signal occurrence — for a
   * `domain_event` signal, the mutation's own freshly-created id (company,
   * contact, lead, or activity id); for a `scanner` signal, the target
   * entity's id. Combined with `organizationId`/`sourceType`/`ruleName`/
   * `ruleVersion`, this forms the unique key `recordSignal` upserts on.
   */
  sourceId: string;
  severity: SignalSeverity;
  /** 0-100, clamped. How much this specific detection should be trusted. */
  confidence: number;
  ruleName: string;
  ruleVersion: string;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  payload?: Record<string, unknown>;
};

export type RecordSignalOutcome = "created" | "updated";

export type ListSignalsInput = {
  organizationId: string;
  status?: SignalStatus;
  relatedEntityType?: string;
  relatedEntityId?: string;
  ruleName?: string;
  limit?: number;
  cursor?: string;
};
