import { getTenantScopedClient } from "@/server/db/tenant";
import { RULE_NAME as OPPORTUNITY_SOURCE_RULE_NAME, RULE_VERSION as OPPORTUNITY_SOURCE_RULE_VERSION } from "@/server/intelligence/signals/rules/high-value-stalled-lead";
import {
  applyEvaluation,
  createPendingOutcomeIfMissing,
  findDueOutcomes,
  markInsufficientEvidence,
} from "@/server/intelligence/outcome/service";

export const RULE_NAME = "opportunity_state_progression";
export const RULE_VERSION = "v1";

const SYSTEM_CONFIDENCE = 90;

export type OpportunityStateProgressionResult = {
  discovered: number;
  evaluated: number;
  insufficientEvidence: number;
};

/**
 * Was flagging a lead as a "high-value stalled lead" Opportunity actually
 * predictive of anything? This rule tracks every `high_value_stalled_lead`
 * v1 Opportunity from the moment it's created (no artificial delay — a
 * lead can convert or get lost at any time) until its related Lead reaches
 * a terminal pipeline stage, or the Opportunity itself is set aside without
 * one:
 *
 *   - Lead won                                  -> success
 *   - Lead lost                                 -> failure
 *   - Lead gone (hard-deleted)                  -> insufficient_evidence
 *   - Opportunity `expired` (Sprint 10's pilot,
 *     lead no longer stalled) or `dismissed`
 *     (human judgment) while lead still open     -> neutral
 *   - still open, still `new`/`reviewed`/`acted`  -> stays pending (no
 *     evidence yet -- this is the important case: never guessed at)
 *
 * `expectedValue` is the Opportunity's `potentialImpact` snapshotted at
 * Outcome-creation time (in `evidence`, not re-read live at evaluation
 * time) — the same `potentialImpact` refreshes on every re-detection pass,
 * so reading it live later would silently answer a different question.
 */
export async function runOpportunityStateProgression(organizationId: string): Promise<OpportunityStateProgressionResult> {
  const discovered = await discoverPending(organizationId);
  const { evaluated, insufficientEvidence } = await evaluateDue(organizationId);
  return { discovered, evaluated, insufficientEvidence };
}

async function discoverPending(organizationId: string): Promise<number> {
  const scoped = getTenantScopedClient(organizationId);
  const opportunities = await scoped.opportunity.findMany({
    where: { ruleName: OPPORTUNITY_SOURCE_RULE_NAME, ruleVersion: OPPORTUNITY_SOURCE_RULE_VERSION },
    select: { id: true, createdAt: true, potentialImpact: true, relatedEntityId: true },
  });

  let discovered = 0;
  for (const opportunity of opportunities) {
    const result = await createPendingOutcomeIfMissing({
      organizationId,
      relatedEntityType: "Opportunity",
      relatedEntityId: opportunity.id,
      ruleName: RULE_NAME,
      ruleVersion: RULE_VERSION,
      observationDueAt: opportunity.createdAt,
      evidence: {
        leadId: opportunity.relatedEntityId,
        expectedValue: Number(opportunity.potentialImpact),
      },
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
    const evidence = outcome.evidence as { leadId?: string | null; expectedValue?: number };
    const leadId = evidence.leadId;
    const expectedValue = evidence.expectedValue ?? 0;

    if (!leadId) {
      await markInsufficientEvidence({ organizationId, outcomeId: outcome.id, evidence: { reason: "no leadId recorded" } });
      insufficientEvidence += 1;
      continue;
    }

    const lead = await scoped.lead.findFirst({
      where: { id: leadId },
      select: { deletedAt: true, stage: { select: { isWon: true, isLost: true } } },
    });

    if (!lead || lead.deletedAt) {
      await markInsufficientEvidence({
        organizationId,
        outcomeId: outcome.id,
        evidence: { reason: "referenced lead no longer exists", leadId },
      });
      insufficientEvidence += 1;
      continue;
    }

    if (lead.stage.isWon) {
      await applyEvaluation({
        outcomeId: outcome.id,
        organizationId,
        outcomeType: "success",
        confidence: SYSTEM_CONFIDENCE,
        evidence: { leadTerminalState: "won" },
        expectedValue,
        observedValue: expectedValue,
      });
      evaluated += 1;
      continue;
    }

    if (lead.stage.isLost) {
      await applyEvaluation({
        outcomeId: outcome.id,
        organizationId,
        outcomeType: "failure",
        confidence: SYSTEM_CONFIDENCE,
        evidence: { leadTerminalState: "lost" },
        expectedValue,
        observedValue: 0,
      });
      evaluated += 1;
      continue;
    }

    const opportunity = await scoped.opportunity.findFirst({ where: { id: outcome.relatedEntityId }, select: { status: true } });
    if (opportunity && (opportunity.status === "expired" || opportunity.status === "dismissed")) {
      await applyEvaluation({
        outcomeId: outcome.id,
        organizationId,
        outcomeType: "neutral",
        confidence: SYSTEM_CONFIDENCE,
        evidence: { leadTerminalState: "still_open", opportunityStatusAtEvaluation: opportunity.status },
      });
      evaluated += 1;
      continue;
    }

    // Lead still open, Opportunity still active -- genuinely no evidence yet. Stays pending.
  }

  return { evaluated, insufficientEvidence };
}
