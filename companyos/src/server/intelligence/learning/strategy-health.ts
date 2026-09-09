import type { StrategyHealthStatus } from "@prisma/client";
import { getTenantScopedClient } from "@/server/db/tenant";
import { recordAuditLog } from "@/server/audit/audit-log";
import { MIN_SAMPLE_SIZE } from "@/server/intelligence/decision-intelligence/sample-safety";
import { getStrategyEvaluations } from "@/server/intelligence/strategy-evaluation/service";
import type { StrategyEvaluation } from "@/server/intelligence/strategy-evaluation/types";

/**
 * Sprint 26: Adaptive Learning -- strategy degradation detection,
 * quarantine, retirement, and controlled discovery. This is deliberately
 * NOT a second scoring system: every input here (`evidenceQuality`,
 * `evaluationScore`, `temporalRobustness`) is read directly off Sprint 18's
 * own `getStrategyEvaluations`, unmodified. This module only adds a state
 * machine ON TOP of that already-computed evidence -- confidence
 * calibration itself is not re-implemented here either, since
 * `evaluationScore` already folds in Sprint 18's own
 * `confidenceCalibrationComponent`.
 *
 * State machine (`StrategyHealthStatus`):
 *   TRIAL -> ACTIVE        automatic, once evidenceQuality clears "insufficient"
 *   ACTIVE -> QUARANTINED  automatic (system actor) -- entering a SAFER state
 *   QUARANTINED -> RETIRED automatic (system actor) -- still degraded after
 *                          a full fresh MIN_SAMPLE_SIZE of new evidence
 *   QUARANTINED -> ACTIVE  NEVER automatic -- human-only (`reactivateStrategy`)
 *   RETIRED -> ACTIVE      NEVER automatic -- human-only (`reactivateStrategy`)
 *
 * This state is READ-ONLY input to the decision/entry layer
 * (`market-decision/service.ts`, `paper-trading/generate.ts`): a
 * QUARANTINED/RETIRED strategy type blocks NEW entries only, exactly like
 * the kill switch -- existing positions are never touched here or by
 * anything this module calls. It can only ever ADD a restriction on top of
 * the existing risk/execution gates, never loosen or bypass one.
 */

/** Below this evaluationScore, with sufficient overall evidence AND a sufficiently-evidenced recent decline, a strategy is considered unhealthy. Not an arbitrary cutoff: the midpoint of the [0,100] scale's lower half, where `computeEvaluationScore`'s own components (win rate, consistency, regime robustness, confidence calibration, minus drawdown/liquidation penalties) can no longer plausibly net positive by chance. */
export const QUARANTINE_SCORE_THRESHOLD = 30;

/** The `recent` temporal bucket's win rate must be at least this many percentage points below the `older` bucket's for the decline to count as a genuine trend, not sampling noise -- documented, not tuned to any specific dataset. */
export const DEGRADATION_WIN_RATE_DROP_PCT = 15;

export type StrategyHealthTransition =
  | { action: "none"; reason: string }
  | { action: "trial_to_active"; reason: string }
  | { action: "quarantine"; reason: string }
  | { action: "retire"; reason: string };

function recentDeclineDetected(evaluation: Extract<StrategyEvaluation, { status: "evaluated" }>): boolean {
  if (evaluation.temporalRobustness.status !== "computed") return false;
  const recent = evaluation.temporalRobustness.buckets.find((b) => b.bucket === "recent");
  const older = evaluation.temporalRobustness.buckets.find((b) => b.bucket === "older");
  if (!recent || !older) return false;
  if (recent.evidenceQuality === "insufficient" || older.evidenceQuality === "insufficient") return false;
  if (recent.winRate === null || older.winRate === null) return false;
  return older.winRate - recent.winRate >= DEGRADATION_WIN_RATE_DROP_PCT;
}

/**
 * Pure, deterministic verdict function -- no I/O, trivially unit-testable.
 * `evaluatedTradesAtQuarantine` is `null` unless `currentStatus` is
 * `QUARANTINED`, matching the schema's own optional field.
 */
export function computeStrategyHealthTransition(
  evaluation: StrategyEvaluation,
  currentStatus: StrategyHealthStatus,
  evaluatedTradesAtQuarantine: number | null,
): StrategyHealthTransition {
  if (evaluation.status === "insufficient_evidence") {
    return { action: "none", reason: `still insufficient evidence (${evaluation.evaluatedTrades}/${evaluation.minimumRequired} evaluated trades)` };
  }

  const evidenceSufficient = evaluation.evidenceQuality === "moderate" || evaluation.evidenceQuality === "strong";
  const isDegraded = evidenceSufficient && evaluation.evaluationScore < QUARANTINE_SCORE_THRESHOLD && recentDeclineDetected(evaluation);
  const quarantineReason = `evaluationScore ${evaluation.evaluationScore} is below the ${QUARANTINE_SCORE_THRESHOLD} quarantine threshold, with a >=${DEGRADATION_WIN_RATE_DROP_PCT}pt win-rate decline in the recent temporal bucket (evidence quality "${evaluation.evidenceQuality}")`;

  if (currentStatus === "TRIAL") {
    // A strategy type can accumulate a large, already-degraded history
    // before its VERY FIRST health check ever runs (e.g. this module
    // shipping after months of real trading) -- graduating it to ACTIVE
    // first and only detecting the decline on a SECOND pass would let an
    // already-unhealthy strategy trade unquarantined for a full extra
    // cycle. If the same evidence that would justify graduation ALSO
    // already shows quarantine-worthy degradation, quarantine directly.
    if (isDegraded) return { action: "quarantine", reason: `${quarantineReason} -- quarantining directly out of TRIAL rather than graduating first` };
    // evaluation.status === "evaluated" already implies evidenceQuality !== "insufficient" (Sprint 18's own MIN_SAMPLE_SIZE gate).
    return { action: "trial_to_active", reason: `evidence quality reached "${evaluation.evidenceQuality}" (${evaluation.evaluatedTrades} evaluated trades) -- graduating out of trial` };
  }

  if (currentStatus === "ACTIVE") {
    if (isDegraded) return { action: "quarantine", reason: quarantineReason };
    return { action: "none", reason: "no degradation detected" };
  }

  if (currentStatus === "QUARANTINED") {
    const newEvidence = evaluatedTradesAtQuarantine !== null ? evaluation.evaluatedTrades - evaluatedTradesAtQuarantine : evaluation.evaluatedTrades;
    if (newEvidence < MIN_SAMPLE_SIZE) {
      return { action: "none", reason: `only ${newEvidence} new evaluated trade(s) since quarantine -- waiting for a fresh ${MIN_SAMPLE_SIZE} before considering retirement` };
    }
    if (evaluation.evaluationScore < QUARANTINE_SCORE_THRESHOLD) {
      return {
        action: "retire",
        reason: `still below the ${QUARANTINE_SCORE_THRESHOLD} quarantine threshold (evaluationScore ${evaluation.evaluationScore}) after ${newEvidence} fresh evaluated trades since quarantine`,
      };
    }
    return { action: "none", reason: `evaluationScore recovered to ${evaluation.evaluationScore} but remains QUARANTINED -- reactivation requires a human (see reactivateStrategy)` };
  }

  // RETIRED is terminal -- automatic detection never acts on it again.
  return { action: "none", reason: "strategy is RETIRED -- no automatic transition applies" };
}

export type StrategyHealthRow = {
  strategyType: string;
  status: StrategyHealthStatus;
  evaluationScoreAtLastCheck: number | null;
  reason: string | null;
  quarantinedAt: Date | null;
  retiredAt: Date | null;
  reactivatedAt: Date | null;
  reactivatedById: string | null;
  lastCheckedAt: Date | null;
};

/**
 * Runs the full detection pass for every strategy type this organization
 * has ever produced a closed `PaperTrade` for (via `getStrategyEvaluations`,
 * unmodified). Lazily creates a `TRIAL` row for a strategy type with no
 * existing health state -- mirrors `policy-service.ts#getOrCreatePolicy`'s
 * own lazy-default discipline. Every applied transition is audited via the
 * existing `AuditLog` (Sprint 1, reused -- no new audit table).
 */
export async function evaluateStrategyHealth(organizationId: string): Promise<{ evaluated: number; transitioned: number }> {
  const scoped = getTenantScopedClient(organizationId);
  const evaluations = await getStrategyEvaluations(organizationId);

  let transitioned = 0;
  for (const evaluation of evaluations) {
    const existing = await scoped.strategyHealthState.findUnique({ where: { organizationId_strategyType: { organizationId, strategyType: evaluation.strategyType } } });
    const currentStatus: StrategyHealthStatus = existing?.status ?? "TRIAL";
    const evaluatedTradesAtQuarantine = existing?.evaluatedTradesAtQuarantine ?? null;

    const transition = computeStrategyHealthTransition(evaluation, currentStatus, evaluatedTradesAtQuarantine);
    const now = new Date();
    const scoreAtCheck = evaluation.status === "evaluated" ? evaluation.evaluationScore : null;
    const evaluatedTradesNow = evaluation.status === "evaluated" ? evaluation.evaluatedTrades : evaluation.evaluatedTrades;

    if (transition.action === "none") {
      await scoped.strategyHealthState.upsert({
        where: { organizationId_strategyType: { organizationId, strategyType: evaluation.strategyType } },
        create: { organizationId, strategyType: evaluation.strategyType, status: "TRIAL", evaluationScoreAtLastCheck: scoreAtCheck, lastCheckedAt: now },
        update: { evaluationScoreAtLastCheck: scoreAtCheck, lastCheckedAt: now },
      });
      continue;
    }

    const newStatus: StrategyHealthStatus = transition.action === "trial_to_active" ? "ACTIVE" : transition.action === "quarantine" ? "QUARANTINED" : "RETIRED";

    await scoped.strategyHealthState.upsert({
      where: { organizationId_strategyType: { organizationId, strategyType: evaluation.strategyType } },
      create: {
        organizationId,
        strategyType: evaluation.strategyType,
        status: newStatus,
        evaluationScoreAtLastCheck: scoreAtCheck,
        reason: transition.reason,
        lastCheckedAt: now,
        quarantinedAt: newStatus === "QUARANTINED" ? now : null,
        retiredAt: newStatus === "RETIRED" ? now : null,
        evaluatedTradesAtQuarantine: newStatus === "QUARANTINED" ? evaluatedTradesNow : null,
      },
      update: {
        status: newStatus,
        evaluationScoreAtLastCheck: scoreAtCheck,
        reason: transition.reason,
        lastCheckedAt: now,
        ...(newStatus === "QUARANTINED" ? { quarantinedAt: now, evaluatedTradesAtQuarantine: evaluatedTradesNow } : {}),
        ...(newStatus === "RETIRED" ? { retiredAt: now } : {}),
      },
    });

    await recordAuditLog({
      organizationId,
      actorId: null,
      actorType: "system",
      action: newStatus === "ACTIVE" ? "learning.strategy_activated" : newStatus === "QUARANTINED" ? "learning.strategy_quarantined" : "learning.strategy_retired",
      targetType: "strategy_health_state",
      targetId: evaluation.strategyType,
      metadata: { strategyType: evaluation.strategyType, reason: transition.reason, evaluationScore: scoreAtCheck },
    });
    transitioned += 1;
  }

  return { evaluated: evaluations.length, transitioned };
}

/** Every strategy health row for an organization, for display/AI-read surfaces. */
export async function listStrategyHealth(organizationId: string): Promise<StrategyHealthRow[]> {
  const scoped = getTenantScopedClient(organizationId);
  const rows = await scoped.strategyHealthState.findMany({ orderBy: { strategyType: "asc" } });
  return rows.map((r) => ({
    strategyType: r.strategyType,
    status: r.status,
    evaluationScoreAtLastCheck: r.evaluationScoreAtLastCheck !== null ? Number(r.evaluationScoreAtLastCheck) : null,
    reason: r.reason,
    quarantinedAt: r.quarantinedAt,
    retiredAt: r.retiredAt,
    reactivatedAt: r.reactivatedAt,
    reactivatedById: r.reactivatedById,
    lastCheckedAt: r.lastCheckedAt,
  }));
}

/**
 * The set of strategy types currently blocked from opening NEW entries
 * (QUARANTINED or RETIRED) -- the exact, minimal read `market-decision/
 * service.ts#generateMarketDecisions` and `paper-trading/generate.ts`
 * both need before proposing/opening a new position. TRIAL and ACTIVE are
 * both fully tradable; TRIAL strategies must keep trading to ever
 * accumulate the evidence that graduates them to ACTIVE.
 */
export async function getBlockedStrategyTypes(organizationId: string): Promise<Set<string>> {
  const scoped = getTenantScopedClient(organizationId);
  const rows = await scoped.strategyHealthState.findMany({
    where: { status: { in: ["QUARANTINED", "RETIRED"] } },
    select: { strategyType: true },
  });
  return new Set(rows.map((r) => r.strategyType));
}

export class StrategyHealthNotFoundError extends Error {
  constructor(strategyType: string) {
    super(`No health state found for strategy type "${strategyType}" in this organization`);
    this.name = "StrategyHealthNotFoundError";
  }
}

export class StrategyHealthNotReactivatableError extends Error {
  constructor(strategyType: string, status: StrategyHealthStatus) {
    super(`Strategy type "${strategyType}" is "${status}" -- only QUARANTINED or RETIRED strategies can be reactivated`);
    this.name = "StrategyHealthNotReactivatableError";
  }
}

/**
 * The ONLY path back to ACTIVE from QUARANTINED/RETIRED -- always a
 * deliberate, audited human action, never automatic. Mirrors
 * `policy-service.ts#disengageKillSwitch`'s own asymmetric-trust design
 * (entering a safer state is automatic; leaving it needs a human). This
 * does not touch, weaken, or bypass any risk/execution gate -- it only
 * removes THIS module's own additive restriction, letting the existing,
 * unmodified entry/decision checks apply again as normal.
 */
export async function reactivateStrategy(params: { organizationId: string; strategyType: string; actorId: string }): Promise<StrategyHealthRow> {
  const { organizationId, strategyType, actorId } = params;
  const scoped = getTenantScopedClient(organizationId);
  const existing = await scoped.strategyHealthState.findUnique({ where: { organizationId_strategyType: { organizationId, strategyType } } });
  if (!existing) throw new StrategyHealthNotFoundError(strategyType);
  if (existing.status !== "QUARANTINED" && existing.status !== "RETIRED") throw new StrategyHealthNotReactivatableError(strategyType, existing.status);

  const now = new Date();
  const updated = await scoped.strategyHealthState.update({
    where: { organizationId_strategyType: { organizationId, strategyType } },
    data: { status: "ACTIVE", reactivatedAt: now, reactivatedById: actorId, evaluatedTradesAtQuarantine: null, reason: `manually reactivated by ${actorId}` },
  });

  await recordAuditLog({
    organizationId,
    actorId,
    actorType: "user",
    action: "learning.strategy_reactivated",
    targetType: "strategy_health_state",
    targetId: strategyType,
    metadata: { strategyType, previousStatus: existing.status },
  });

  return {
    strategyType: updated.strategyType,
    status: updated.status,
    evaluationScoreAtLastCheck: updated.evaluationScoreAtLastCheck !== null ? Number(updated.evaluationScoreAtLastCheck) : null,
    reason: updated.reason,
    quarantinedAt: updated.quarantinedAt,
    retiredAt: updated.retiredAt,
    reactivatedAt: updated.reactivatedAt,
    reactivatedById: updated.reactivatedById,
    lastCheckedAt: updated.lastCheckedAt,
  };
}
