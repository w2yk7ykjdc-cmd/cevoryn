import { getTenantScopedClient } from "@/server/db/tenant";
import {
  applyEvaluation,
  createPendingOutcomeIfMissing,
  findDueOutcomes,
  markInsufficientEvidence,
} from "@/server/intelligence/outcome/service";

export const RULE_NAME = "stale_advisory_resolution";
export const RULE_VERSION = "v1";

/**
 * How long an autonomous `expire_stale_opportunity` execution is left
 * `pending` before being evaluated. This is a purely internal, reversible
 * housekeeping action with no external side effect, so the window exists
 * only to give the (currently nonexistent, but future-possible) case of a
 * human noticing and manually correcting the record a chance to happen
 * before the outcome is called `success` — 24 hours is long enough to
 * cover a business day, short enough to close the loop quickly.
 */
const OBSERVATION_WINDOW_MS = 24 * 60 * 60 * 1000;
const SYSTEM_CONFIDENCE = 90;

export type StaleAdvisoryResolutionResult = {
  discovered: number;
  evaluated: number;
  insufficientEvidence: number;
};

/**
 * Was Sprint 10's `expire_stale_opportunity` autonomous action actually
 * good? Execution succeeding (`AutonomousActionLog.outcome === "executed"`)
 * is never itself the verdict — this rule instead re-checks, after the
 * observation window, whether the Opportunity it acted on is STILL
 * `"expired"`. Since no mechanism in CompanyOS currently exists to move an
 * Opportunity out of `"expired"`, this will always currently observe
 * `success` — that is the honest, correct behavior given today's real
 * system, not a shortcut: the rule is written to also correctly detect a
 * future reversal mechanism the moment one exists, without needing to
 * change.
 *
 * Reads `opportunityId` out of `AutonomousActionLog.input` (the tool call's
 * own arguments) rather than `.output` or `.toolInvocationId` — neither of
 * those is ever actually populated by `resolveAutonomyDecision`/
 * `executeToolCall` today (verified by inspection, not assumed), so `input`
 * is the only reliable soft link back to the acted-on Opportunity.
 */
export async function runStaleAdvisoryResolution(organizationId: string): Promise<StaleAdvisoryResolutionResult> {
  const discovered = await discoverPending(organizationId);
  const { evaluated, insufficientEvidence } = await evaluateDue(organizationId);
  return { discovered, evaluated, insufficientEvidence };
}

async function discoverPending(organizationId: string): Promise<number> {
  const scoped = getTenantScopedClient(organizationId);
  const executedActions = await scoped.autonomousActionLog.findMany({
    where: { toolName: "expire_stale_opportunity", outcome: "executed" },
    select: { id: true, createdAt: true, input: true },
  });

  let discovered = 0;
  for (const action of executedActions) {
    const input = action.input as { opportunityId?: string };
    const result = await createPendingOutcomeIfMissing({
      organizationId,
      relatedEntityType: "AutonomousActionLog",
      relatedEntityId: action.id,
      ruleName: RULE_NAME,
      ruleVersion: RULE_VERSION,
      autonomousActionLogId: action.id,
      observationDueAt: new Date(action.createdAt.getTime() + OBSERVATION_WINDOW_MS),
      evidence: { opportunityId: input.opportunityId ?? null },
    });
    if (result.created) discovered += 1;
  }
  return discovered;
}

async function evaluateDue(organizationId: string): Promise<{ evaluated: number; insufficientEvidence: number }> {
  const scoped = getTenantScopedClient(organizationId);
  const due = await findDueOutcomes(organizationId, RULE_NAME, RULE_VERSION);

  let evaluated = 0;
  let insufficientEvidence = 0;

  for (const outcome of due) {
    const evidence = outcome.evidence as { opportunityId?: string | null };
    const opportunityId = evidence.opportunityId;

    if (!opportunityId) {
      await markInsufficientEvidence({ organizationId, outcomeId: outcome.id, evidence: { reason: "no opportunityId recorded" } });
      insufficientEvidence += 1;
      continue;
    }

    const opportunity = await scoped.opportunity.findFirst({ where: { id: opportunityId }, select: { status: true } });
    if (!opportunity) {
      await markInsufficientEvidence({
        organizationId,
        outcomeId: outcome.id,
        evidence: { reason: "referenced opportunity no longer exists", opportunityId },
      });
      insufficientEvidence += 1;
      continue;
    }

    const outcomeType = opportunity.status === "expired" ? "success" : "reversed";
    await applyEvaluation({
      outcomeId: outcome.id,
      organizationId,
      outcomeType,
      confidence: SYSTEM_CONFIDENCE,
      evidence: { opportunityStatusAtEvaluation: opportunity.status },
    });
    evaluated += 1;
  }

  return { evaluated, insufficientEvidence };
}
