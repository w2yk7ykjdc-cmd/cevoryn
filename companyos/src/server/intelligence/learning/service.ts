import { prisma } from "@/server/db/client";
import { getTenantScopedClient } from "@/server/db/tenant";
import type {
  AutonomousActionPerformance,
  ConfidenceBucket,
  OutcomePerformance,
  PerformanceFilter,
  RecordLearningInput,
} from "@/server/intelligence/learning/types";

function isUniqueConstraintViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "P2002";
}

/**
 * Writes one structured `LearningRecord` snapshot for an evaluated
 * `Outcome` — never AI conversational memory (see `LearningRecord`'s
 * schema doc comment for why this is a separate model from `MemoryRecord`).
 * Idempotent on `outcomeId` (unique): a repeated evaluation pass, a retried
 * job, or a race between concurrent workers can never produce two
 * `LearningRecord` rows for the same `Outcome` — the `findUnique` check
 * handles the common case cheaply, and the `P2002` catch handles the rare
 * concurrent-race case without a second round trip on every call.
 */
export async function recordLearningIfMissing(input: RecordLearningInput): Promise<void> {
  const existing = await prisma.learningRecord.findUnique({ where: { outcomeId: input.outcomeId }, select: { id: true } });
  if (existing) return;

  const errorValue =
    input.expectedValue !== undefined && input.observedValue !== undefined
      ? input.observedValue - input.expectedValue
      : undefined;

  try {
    await prisma.learningRecord.create({
      data: {
        organizationId: input.organizationId,
        outcomeId: input.outcomeId,
        decisionId: input.decisionId ?? null,
        autonomousActionLogId: input.autonomousActionLogId ?? null,
        relatedEntityType: input.relatedEntityType,
        relatedEntityId: input.relatedEntityId,
        ruleName: input.ruleName,
        ruleVersion: input.ruleVersion,
        outcomeType: input.outcomeType,
        expectedValue: input.expectedValue ?? null,
        observedValue: input.observedValue ?? null,
        errorValue: errorValue ?? null,
        evaluationConfidence: input.evaluationConfidence,
      },
    });
  } catch (err) {
    if (!isUniqueConstraintViolation(err)) throw err;
    // A concurrent evaluation already recorded learning for this outcome -- not an error.
  }
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Organization-scoped performance over evaluated `Outcome`s, optionally
 * narrowed to one rule or one subject type. Pure database aggregation — no
 * ML, no statistics package, matching the Sprint 11 mandate to build the
 * data foundation, not a model. `successRate`/`averageConfidence`/
 * `averageTimeToOutcomeMs` are `null` (not `0`) when there is no evaluated
 * evidence yet, so an empty organization is never misreported as "0%
 * success" — the same "no evidence yet" vs "it failed" distinction the
 * `Outcome` model itself enforces.
 */
export async function getOutcomePerformance(filter: PerformanceFilter): Promise<OutcomePerformance> {
  const scoped = getTenantScopedClient(filter.organizationId);
  const where = {
    ruleName: filter.ruleName,
    ruleVersion: filter.ruleVersion,
    relatedEntityType: filter.relatedEntityType,
    decisionId: filter.requireDecisionLink ? { not: null } : undefined,
  };

  const [byOutcomeType, pendingCount, insufficientEvidenceCount, evaluatedAggregate, evaluatedRows] = await Promise.all([
    scoped.outcome.groupBy({
      by: ["outcomeType"],
      where: { ...where, evaluationStatus: "evaluated" },
      _count: { _all: true },
    }),
    scoped.outcome.count({ where: { ...where, evaluationStatus: "pending" } }),
    scoped.outcome.count({ where: { ...where, evaluationStatus: "insufficient_evidence" } }),
    scoped.outcome.aggregate({
      where: { ...where, evaluationStatus: "evaluated" },
      _avg: { confidence: true },
      _count: { _all: true },
    }),
    scoped.outcome.findMany({
      where: { ...where, evaluationStatus: "evaluated", observedAt: { not: null } },
      select: { createdAt: true, observedAt: true },
    }),
  ]);

  const counts: Record<string, number> = {};
  for (const row of byOutcomeType) {
    counts[row.outcomeType ?? "unknown"] = row._count._all;
  }

  const totalEvaluated = evaluatedAggregate._count._all;
  const successCount = counts.success ?? 0;

  const averageTimeToOutcomeMs =
    evaluatedRows.length > 0
      ? evaluatedRows.reduce((sum, row) => sum + (row.observedAt!.getTime() - row.createdAt.getTime()), 0) / evaluatedRows.length
      : null;

  return {
    totalEvaluated,
    successCount,
    failureCount: counts.failure ?? 0,
    neutralCount: counts.neutral ?? 0,
    expiredCount: counts.expired ?? 0,
    reversedCount: counts.reversed ?? 0,
    unknownCount: counts.unknown ?? 0,
    pendingCount,
    insufficientEvidenceCount,
    successRate: totalEvaluated > 0 ? round2((successCount / totalEvaluated) * 100) : null,
    averageConfidence: evaluatedAggregate._avg.confidence !== null ? round2(evaluatedAggregate._avg.confidence) : null,
    averageTimeToOutcomeMs: averageTimeToOutcomeMs !== null ? Math.round(averageTimeToOutcomeMs) : null,
  };
}

/**
 * Same shape of measurement as `getOutcomePerformance`, narrowed to
 * `AutonomousActionLog`-subject outcomes specifically, plus the two
 * autonomy-specific questions Sprint 11 exists to answer: did an
 * autonomous action's effect actually stick (`successRate`), and how often
 * did it not (`reversalRate`)? `totalExecuted` is read directly from
 * `AutonomousActionLog` (Sprint 9's own record of what actually ran) —
 * deliberately NOT the same number as `outcomesTracked`, since execution
 * succeeding is never conflated with the business outcome being good (an
 * executed action can still have no `Outcome` row yet, or one that's still
 * pending).
 */
export async function getAutonomousActionPerformance(organizationId: string): Promise<AutonomousActionPerformance> {
  const scoped = getTenantScopedClient(organizationId);

  const [totalExecuted, outcomeRows] = await Promise.all([
    scoped.autonomousActionLog.count({ where: { outcome: "executed" } }),
    scoped.outcome.findMany({
      where: { relatedEntityType: "AutonomousActionLog" },
      select: { evaluationStatus: true, outcomeType: true },
    }),
  ]);

  let pendingCount = 0;
  let evaluatedCount = 0;
  let successCount = 0;
  let reversedCount = 0;
  let otherCount = 0;

  for (const row of outcomeRows) {
    if (row.evaluationStatus !== "evaluated") {
      pendingCount += 1;
      continue;
    }
    evaluatedCount += 1;
    if (row.outcomeType === "success") successCount += 1;
    else if (row.outcomeType === "reversed") reversedCount += 1;
    else otherCount += 1;
  }

  return {
    totalExecuted,
    outcomesTracked: outcomeRows.length,
    pendingCount,
    evaluatedCount,
    successCount,
    reversedCount,
    otherCount,
    successRate: evaluatedCount > 0 ? round2((successCount / evaluatedCount) * 100) : null,
    reversalRate: evaluatedCount > 0 ? round2((reversedCount / evaluatedCount) * 100) : null,
  };
}

/**
 * Ready for a future decision-linked evaluation rule: aggregates any
 * evaluated `Outcome` rows that carry a `decisionId`. Sprint 11 ships no
 * rule that populates `decisionId` yet (a `Decision` row is fully
 * recomputed/deleted on every pass rather than carrying a stable identity
 * over time the way `Opportunity`/`Risk` do, so linking an outcome to one
 * safely needs more design than this sprint's scope allows — see the
 * README's Sprint 11 section) — this legitimately returns all-null/zero
 * until one exists, which is correct, not a bug.
 */
export async function getDecisionPerformance(organizationId: string): Promise<OutcomePerformance> {
  return getOutcomePerformance({ organizationId, requireDecisionLink: true });
}

const CONFIDENCE_BUCKETS: { label: string; min: number; max: number }[] = [
  { label: "0-59", min: 0, max: 59 },
  { label: "60-79", min: 60, max: 79 },
  { label: "80-89", min: 80, max: 89 },
  { label: "90-100", min: 90, max: 100 },
];

/**
 * Answers "when the system says confidence 90, how often is the outcome
 * actually positive" — pure aggregation over real evaluated outcomes,
 * bucketed into four fixed, deterministic ranges. `observedSuccessRate` is
 * `null` for a bucket with zero evaluated outcomes, never `0`, so an
 * unpopulated bucket is never misread as "calibrated to 0% success."
 */
export async function getConfidenceCalibration(organizationId: string): Promise<ConfidenceBucket[]> {
  const scoped = getTenantScopedClient(organizationId);

  const buckets: ConfidenceBucket[] = [];
  for (const bucket of CONFIDENCE_BUCKETS) {
    const [totalEvaluated, successCount] = await Promise.all([
      scoped.outcome.count({
        where: { evaluationStatus: "evaluated", confidence: { gte: bucket.min, lte: bucket.max } },
      }),
      scoped.outcome.count({
        where: { evaluationStatus: "evaluated", confidence: { gte: bucket.min, lte: bucket.max }, outcomeType: "success" },
      }),
    ]);

    buckets.push({
      ...bucket,
      totalEvaluated,
      successCount,
      observedSuccessRate: totalEvaluated > 0 ? round2((successCount / totalEvaluated) * 100) : null,
    });
  }

  return buckets;
}
