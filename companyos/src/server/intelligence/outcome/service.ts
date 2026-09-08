import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { getTenantScopedClient } from "@/server/db/tenant";
import { auth } from "@/server/auth/auth";
import { recordAuditLog } from "@/server/audit/audit-log";
import { recordLearningIfMissing } from "@/server/intelligence/learning/service";
import {
  OutcomeNotFoundError,
  OutcomePermissionError,
  type ApplyEvaluationInput,
  type ConfirmOutcomeInput,
  type CreatePendingOutcomeInput,
  type ListOutcomesInput,
  type MarkInsufficientEvidenceInput,
} from "@/server/intelligence/outcome/types";

async function assertPermission(organizationId: string, requestHeaders: Headers, permission: string[]): Promise<void> {
  const permitted = await auth.api.hasPermission({
    headers: requestHeaders,
    body: { organizationId, permissions: { outcome: permission } as Record<string, string[]> },
  });
  if (!permitted.success) throw new OutcomePermissionError(permission.join("/"));
}

/**
 * Opens a new `pending` `Outcome` row for a subject a rule's discovery pass
 * just found, or does nothing if one already exists — idempotent by
 * construction via the same `[organizationId, ruleName, ruleVersion,
 * relatedEntityType, relatedEntityId]` upsert-key shape `Opportunity`/`Risk`
 * already use. Never called for a subject that already has a row: a rule's
 * re-detection must never reset an `evaluated`/`insufficient_evidence` row
 * back to `pending`, exactly mirroring "re-detection never overwrites a
 * human's own triage status" elsewhere in this codebase.
 */
export async function createPendingOutcomeIfMissing(input: CreatePendingOutcomeInput): Promise<{ created: boolean }> {
  const scoped = getTenantScopedClient(input.organizationId);
  const existing = await scoped.outcome.findFirst({
    where: {
      ruleName: input.ruleName,
      ruleVersion: input.ruleVersion,
      relatedEntityType: input.relatedEntityType,
      relatedEntityId: input.relatedEntityId,
    },
    select: { id: true },
  });
  if (existing) return { created: false };

  await prisma.outcome.create({
    data: {
      organizationId: input.organizationId,
      relatedEntityType: input.relatedEntityType,
      relatedEntityId: input.relatedEntityId,
      ruleName: input.ruleName,
      ruleVersion: input.ruleVersion,
      autonomousActionLogId: input.autonomousActionLogId ?? null,
      decisionId: input.decisionId ?? null,
      signalId: input.signalId ?? null,
      evaluationStatus: "pending",
      observationDueAt: input.observationDueAt,
      evidence: (input.evidence ?? {}) as Prisma.InputJsonValue,
    },
  });

  return { created: true };
}

/**
 * Finds every `pending` `Outcome` row for one rule that is due for
 * evaluation (`observationDueAt` has passed) and has NOT been confirmed by
 * a human — a human-sourced row is permanently excluded from automatic
 * re-evaluation, the same invariant `Opportunity`/`Risk` already apply to
 * their own human-set statuses.
 */
export async function findDueOutcomes(organizationId: string, ruleName: string, ruleVersion: string) {
  const scoped = getTenantScopedClient(organizationId);
  return scoped.outcome.findMany({
    where: {
      ruleName,
      ruleVersion,
      evaluationStatus: "pending",
      observationDueAt: { lte: new Date() },
      // `source` is null for every row a rule has never evaluated yet -- a
      // plain `{ not: "human" }` on a nullable column excludes those NULLs
      // too (standard SQL three-valued logic), which would silently starve
      // every fresh pending row of automatic evaluation. Spelled out as an
      // explicit OR so both "never touched" and "touched by something
      // other than a human" are included, and only `source: "human"` rows
      // are excluded.
      OR: [{ source: null }, { source: { not: "human" } }],
    },
  });
}

/**
 * Applies a rule's deterministic, system-sourced verdict to a `pending`
 * `Outcome` row: transitions it to `evaluated`, writes the `AuditLog`
 * entry capturing the before/after state (the append-only history —
 * `Outcome` itself is mutated in place, `AuditLog` is where the trail
 * lives, per the schema's own doc comment), and records a `LearningRecord`
 * when `expectedValue`/`observedValue` are known. Execution success is
 * never conflated with business outcome here — the caller (a rule module)
 * is the one place that decides `outcomeType`, always from observed
 * database state, never from whether a tool call itself merely succeeded.
 */
export async function applyEvaluation(input: ApplyEvaluationInput): Promise<void> {
  const previous = await prisma.outcome.findUniqueOrThrow({ where: { id: input.outcomeId } });

  const updated = await prisma.outcome.update({
    where: { id: input.outcomeId },
    data: {
      evaluationStatus: "evaluated",
      outcomeType: input.outcomeType,
      source: "system",
      confidence: input.confidence,
      value: input.value ?? null,
      currency: input.currency ?? null,
      evidence: { ...(previous.evidence as object), ...(input.evidence ?? {}) } as Prisma.InputJsonValue,
      observedAt: new Date(),
    },
  });

  await recordAuditLog({
    organizationId: input.organizationId,
    actorId: null,
    actorType: "system",
    action: "outcome.evaluated",
    targetType: "outcome",
    targetId: updated.id,
    metadata: {
      ruleName: updated.ruleName,
      ruleVersion: updated.ruleVersion,
      previousEvaluationStatus: previous.evaluationStatus,
      previousOutcomeType: previous.outcomeType,
      newEvaluationStatus: "evaluated",
      newOutcomeType: input.outcomeType,
    },
  });

  if (input.expectedValue !== undefined || input.observedValue !== undefined) {
    await recordLearningIfMissing({
      organizationId: input.organizationId,
      outcomeId: updated.id,
      relatedEntityType: updated.relatedEntityType,
      relatedEntityId: updated.relatedEntityId,
      ruleName: updated.ruleName,
      ruleVersion: updated.ruleVersion,
      outcomeType: input.outcomeType,
      decisionId: updated.decisionId ?? undefined,
      autonomousActionLogId: updated.autonomousActionLogId ?? undefined,
      expectedValue: input.expectedValue,
      observedValue: input.observedValue,
      evaluationConfidence: input.confidence,
    });
  }
}

/**
 * Marks a `pending` `Outcome` as `insufficient_evidence` — the underlying
 * subject (e.g. a referenced Lead or CompanySignal) is gone or otherwise
 * unobservable. Deliberately distinct from `evaluated`: this is not a
 * verdict, it is the honest absence of one, so `outcomeType` stays null.
 */
export async function markInsufficientEvidence(input: MarkInsufficientEvidenceInput): Promise<void> {
  const previous = await prisma.outcome.findUniqueOrThrow({ where: { id: input.outcomeId } });

  const updated = await prisma.outcome.update({
    where: { id: input.outcomeId },
    data: {
      evaluationStatus: "insufficient_evidence",
      source: "system",
      evidence: { ...(previous.evidence as object), ...(input.evidence ?? {}) } as Prisma.InputJsonValue,
      observedAt: new Date(),
    },
  });

  await recordAuditLog({
    organizationId: input.organizationId,
    actorId: null,
    actorType: "system",
    action: "outcome.evaluated",
    targetType: "outcome",
    targetId: updated.id,
    metadata: {
      ruleName: updated.ruleName,
      ruleVersion: updated.ruleVersion,
      previousEvaluationStatus: previous.evaluationStatus,
      previousOutcomeType: previous.outcomeType,
      newEvaluationStatus: "insufficient_evidence",
      newOutcomeType: null,
    },
  });
}

/**
 * The sole human-facing path for setting an `Outcome`'s verdict —
 * RBAC-gated (`outcome:confirm`), never reachable through an AI tool: an
 * LLM can relay a human's words, but it can never itself be the caller
 * that satisfies this permission check, so ground truth always traces back
 * to a real, authenticated person. `confidence` is always `100` — a
 * human's explicit confirmation is definitionally the strongest evidence
 * this system can have (see the `OutcomeSource` schema doc comment).
 * Confirming an outcome that a system evaluation already reached
 * (`evaluated`) is a deliberate override, not blocked — a human is always
 * allowed to correct the system's own read of the evidence; the previous
 * state is preserved in the `AuditLog` entry, never silently lost.
 */
export async function confirmOutcome(input: ConfirmOutcomeInput): Promise<void> {
  await assertPermission(input.organizationId, input.requestHeaders, ["confirm"]);

  const scoped = getTenantScopedClient(input.organizationId);
  const previous = await scoped.outcome.findFirst({ where: { id: input.outcomeId } });
  if (!previous) throw new OutcomeNotFoundError(input.outcomeId);

  const updated = await prisma.outcome.update({
    where: { id: input.outcomeId },
    data: {
      evaluationStatus: "evaluated",
      outcomeType: input.outcomeType,
      source: "human",
      confidence: 100,
      observedAt: new Date(),
      evidence: input.note
        ? ({ ...(previous.evidence as object), humanNote: input.note } as Prisma.InputJsonValue)
        : (previous.evidence as Prisma.InputJsonValue),
    },
  });

  await recordAuditLog({
    organizationId: input.organizationId,
    actorId: input.confirmedById,
    actorType: "user",
    action: "outcome.confirmed",
    targetType: "outcome",
    targetId: updated.id,
    metadata: {
      ruleName: updated.ruleName,
      ruleVersion: updated.ruleVersion,
      previousEvaluationStatus: previous.evaluationStatus,
      previousOutcomeType: previous.outcomeType,
      previousSource: previous.source,
      newOutcomeType: input.outcomeType,
      note: input.note ?? null,
    },
  });
}

/** Paginated, filterable read path — mirrors `listOpportunities`/`listRisks`'s shape. */
export async function listOutcomes(input: ListOutcomesInput) {
  const scoped = getTenantScopedClient(input.organizationId);
  const limit = Math.min(input.limit ?? 50, 200);

  const outcomes = await scoped.outcome.findMany({
    where: { evaluationStatus: input.evaluationStatus, relatedEntityType: input.relatedEntityType },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });

  const hasMore = outcomes.length > limit;
  const page = hasMore ? outcomes.slice(0, limit) : outcomes;

  return { outcomes: page, nextCursor: hasMore ? page[page.length - 1]?.id : null };
}
