import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { getTenantScopedClient } from "@/server/db/tenant";
import {
  pickTopPriorityItem,
  RULE_NAME,
  RULE_VERSION,
  type DecisionCandidate,
} from "@/server/intelligence/decision/rules/top-priority-item";

export type GenerateDecisionResult = {
  candidateCount: number;
  decided: boolean;
};

/**
 * Every currently-live decision candidate (open `Risk`s + active
 * `Opportunity`s) for one organization, in `DecisionCandidate` shape.
 * Extracted from `generateDecisionForOrganization` so Sprint 12's
 * `decision-intelligence/service.ts` can rank the SAME live candidate set
 * `pickTopPriorityItem` picks its single winner from, without duplicating
 * this query or risking the two ever silently diverging. Behavior of
 * `generateDecisionForOrganization` itself is unchanged by this extraction.
 */
export async function getDecisionCandidatesForOrganization(organizationId: string): Promise<DecisionCandidate[]> {
  const scoped = getTenantScopedClient(organizationId);

  const [openRisks, activeOpportunities] = await Promise.all([
    scoped.risk.findMany({ where: { status: "open" } }),
    scoped.opportunity.findMany({ where: { status: { in: ["new", "reviewed"] } } }),
  ]);

  return [
    ...openRisks.map(
      (risk): DecisionCandidate => ({
        kind: "risk",
        id: risk.id,
        title: risk.title,
        explanation: risk.explanation,
        severity: risk.severity,
        potentialLoss: Number(risk.potentialLoss),
        detectedAt: risk.detectedAt,
        confidence: risk.confidence,
      }),
    ),
    ...activeOpportunities.map(
      (opportunity): DecisionCandidate => ({
        kind: "opportunity",
        id: opportunity.id,
        title: opportunity.title,
        explanation: opportunity.explanation,
        urgency: opportunity.urgency,
        potentialImpact: Number(opportunity.potentialImpact),
        detectedAt: opportunity.detectedAt,
        confidence: opportunity.confidence,
      }),
    ),
  ];
}

/**
 * Recomputes the organization's single top-priority `Decision` from its
 * currently open `Risk`s and active `Opportunity`s. Deliberately reads
 * those two models directly (not the `CompanySignal` ledger) — by this
 * stage they are already the ranked, explained output of the Sprint 6/7
 * engines, so re-deriving from raw signals here would just duplicate that
 * work with a second, potentially-diverging notion of "what matters."
 *
 * Unlike `Opportunity`/`Risk`, a `Decision` carries no human-editable
 * status: it is fully overwritten on every call (or deleted entirely when
 * no candidate remains) rather than upserted-and-preserved, because this
 * row is read-only advisory synthesis, not an action item — there is
 * nothing here for a human to triage that isn't already tracked on the
 * underlying `Risk`/`Opportunity` itself.
 */
export async function generateDecisionForOrganization(organizationId: string): Promise<GenerateDecisionResult> {
  const candidates = await getDecisionCandidatesForOrganization(organizationId);
  const picked = pickTopPriorityItem(candidates);

  if (!picked) {
    await prisma.decision.deleteMany({ where: { organizationId, ruleName: RULE_NAME, ruleVersion: RULE_VERSION } });
    return { candidateCount: 0, decided: false };
  }

  const key = { organizationId_ruleName_ruleVersion: { organizationId, ruleName: RULE_NAME, ruleVersion: RULE_VERSION } };
  await prisma.decision.upsert({
    where: key,
    create: {
      organizationId,
      ruleName: RULE_NAME,
      ruleVersion: RULE_VERSION,
      recommendation: picked.recommendation,
      rationale: picked.rationale,
      sourceType: picked.sourceType,
      sourceId: picked.sourceId,
      priorityScore: picked.priorityScore,
      evidence: picked.evidence as Prisma.InputJsonValue,
    },
    update: {
      recommendation: picked.recommendation,
      rationale: picked.rationale,
      sourceType: picked.sourceType,
      sourceId: picked.sourceId,
      priorityScore: picked.priorityScore,
      evidence: picked.evidence as Prisma.InputJsonValue,
      detectedAt: new Date(),
    },
  });

  return { candidateCount: candidates.length, decided: true };
}

/** The organization's current top-priority Decision, or `null` if none exists. */
export async function getDecisionForOrganization(organizationId: string) {
  const scoped = getTenantScopedClient(organizationId);
  return scoped.decision.findFirst({ where: { ruleName: RULE_NAME, ruleVersion: RULE_VERSION } });
}
