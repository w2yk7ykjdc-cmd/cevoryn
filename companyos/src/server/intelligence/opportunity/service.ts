import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { getTenantScopedClient } from "@/server/db/tenant";
import {
  RULE_NAME,
  RULE_VERSION,
  evaluateHighValueStalledLead,
  medianOpenLeadValue,
} from "@/server/intelligence/signals/rules/high-value-stalled-lead";
import { generateHighValueStalledLeadOpportunity } from "@/server/intelligence/opportunity/rules/high-value-stalled-lead";
import { recordAuditLog, publishAuditEvent } from "@/server/audit/audit-log";
import type {
  ExpireStaleOpportunityInput,
  ExpireStaleOpportunityResult,
  ListOpportunitiesInput,
} from "@/server/intelligence/opportunity/types";

export type GenerateOpportunitiesResult = {
  signalsEvaluated: number;
  opportunitiesCreated: number;
  opportunitiesUpdated: number;
};

/**
 * Generates/refreshes Opportunities for one organization from its active
 * `high_value_stalled_lead` CompanySignal rows — the V1 Opportunity Engine's
 * only rule. Reads signals (not leads directly) so this stays a pure
 * "signal → opportunity" projection, matching the layered pipeline the
 * organization committed to (events → signals → opportunities), and gets
 * the scanner's idempotent re-detection for free instead of duplicating it.
 *
 * Upserts on the same `[organizationId, ruleName, ruleVersion,
 * relatedEntityType, relatedEntityId]` shape `CompanySignal` uses, via the
 * raw `prisma` client — like `recordSignal`, this uses `upsert`, which the
 * tenant-scoping extension does not intercept (see `src/server/db/tenant.ts`
 * and `signals/service.ts`'s `recordSignal` for the identical precedent) —
 * so `organizationId` is included explicitly here too. `status` is
 * deliberately left out of the `update` payload so a human's triage
 * decision (`reviewed`/`acted`/`dismissed`) is never silently reset by a
 * later re-detection of the same still-stalled lead.
 */
export async function generateOpportunitiesForOrganization(
  organizationId: string,
): Promise<GenerateOpportunitiesResult> {
  const scoped = getTenantScopedClient(organizationId);

  const activeSignals = await scoped.companySignal.findMany({
    where: { ruleName: RULE_NAME, ruleVersion: RULE_VERSION, status: "active", relatedEntityType: "Lead" },
  });

  let opportunitiesCreated = 0;
  let opportunitiesUpdated = 0;

  for (const signal of activeSignals) {
    if (!signal.relatedEntityId) continue;

    const lead = await scoped.lead.findFirst({
      where: { id: signal.relatedEntityId, deletedAt: null },
      select: { id: true, title: true, value: true },
    });
    if (!lead) continue; // lead was deleted/closed since the signal was recorded — nothing to act on

    const payload = signal.payload as {
      daysSinceLastActivity?: number;
      orgMedianOpenValue?: number;
      hasActivityHistory?: boolean;
    };

    const generated = generateHighValueStalledLeadOpportunity({
      leadId: lead.id,
      leadTitle: lead.title,
      leadValue: Number(lead.value),
      orgMedianOpenValue: payload.orgMedianOpenValue ?? 0,
      daysSinceLastActivity: payload.daysSinceLastActivity ?? 0,
      hasActivityHistory: payload.hasActivityHistory ?? false,
      signalSeverity: signal.severity as "medium" | "high",
      signalConfidence: signal.confidence,
      signalId: signal.id,
    });

    const key = {
      organizationId_ruleName_ruleVersion_relatedEntityType_relatedEntityId: {
        organizationId,
        ruleName: generated.ruleName,
        ruleVersion: generated.ruleVersion,
        relatedEntityType: generated.relatedEntityType,
        relatedEntityId: generated.relatedEntityId,
      },
    };

    const existing = await prisma.opportunity.findUnique({ where: key, select: { id: true } });

    await prisma.opportunity.upsert({
      where: key,
      create: {
        organizationId,
        type: generated.type,
        title: generated.title,
        description: generated.description,
        score: generated.score,
        confidence: generated.confidence,
        potentialImpact: generated.potentialImpact,
        effort: generated.effort,
        urgency: generated.urgency,
        risk: generated.risk,
        evidence: generated.evidence as Prisma.InputJsonValue,
        explanation: generated.explanation,
        relatedEntityType: generated.relatedEntityType,
        relatedEntityId: generated.relatedEntityId,
        sourceSignalId: generated.sourceSignalId,
        ruleName: generated.ruleName,
        ruleVersion: generated.ruleVersion,
      },
      update: {
        title: generated.title,
        description: generated.description,
        score: generated.score,
        confidence: generated.confidence,
        potentialImpact: generated.potentialImpact,
        effort: generated.effort,
        urgency: generated.urgency,
        risk: generated.risk,
        evidence: generated.evidence as Prisma.InputJsonValue,
        explanation: generated.explanation,
        sourceSignalId: generated.sourceSignalId,
        detectedAt: new Date(),
      },
    });

    if (existing) opportunitiesUpdated += 1;
    else opportunitiesCreated += 1;
  }

  return { signalsEvaluated: activeSignals.length, opportunitiesCreated, opportunitiesUpdated };
}

/** Paginated, filterable read path — mirrors `listSignals`'s shape. */
export async function listOpportunities(input: ListOpportunitiesInput) {
  const scoped = getTenantScopedClient(input.organizationId);
  const limit = Math.min(input.limit ?? 50, 200);

  const opportunities = await scoped.opportunity.findMany({
    where: { status: input.status },
    orderBy: [{ score: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });

  const hasMore = opportunities.length > limit;
  const page = hasMore ? opportunities.slice(0, limit) : opportunities;

  return { opportunities: page, nextCursor: hasMore ? page[page.length - 1]?.id : null };
}

/**
 * Sprint 10's first real autonomy pilot: transitions ONE `Opportunity` from
 * `"new"` to `"expired"` when it is provably stale — never invented as a
 * vague "old enough" check, but derived by re-running the EXACT rule
 * function that created the Opportunity in the first place
 * (`evaluateHighValueStalledLead`) against the related Lead's CURRENT
 * state. This is the one place in the codebase that ever writes anything
 * other than `"new"` to `Opportunity.status` outside a human's own triage
 * action — `status` values besides `"new"`/the ones a human sets
 * (`reviewed`/`acted`/`dismissed`) were forward-compatible schema surface
 * (`OpportunityStatus.expired`) since Sprint 6, never wired to any mutation
 * until now.
 *
 * Eligibility (deterministic, code-owned — the caller, human or AI, never
 * decides this; it is always independently re-verified here):
 *   1. The Opportunity exists in this organization and was generated by the
 *      one rule this pilot understands (`high_value_stalled_lead` v1).
 *   2. Its `status` is still exactly `"new"` — a human's own triage
 *      decision (`reviewed`/`acted`/`dismissed`) is NEVER touched, and an
 *      already-`"expired"` row is a no-op, not an error.
 *   3. Its `relatedEntityType`/`relatedEntityId` point at a real Lead.
 *   4. The Lead is now stale-and-irrelevant: gone (hard-deleted), soft
 *      deleted, won, lost, or — re-running `evaluateHighValueStalledLead`
 *      against its CURRENT activity/value/stage — no longer stalled or no
 *      longer above this organization's current median open-lead value.
 *
 * The actual write is a single conditional `updateMany` scoped to
 * `status: "new"` — Postgres serializes concurrent UPDATEs against the
 * same row, so two simultaneous callers can never both "win": the second
 * one's `WHERE status = "new"` matches zero rows once the first commits,
 * which this function reports back as `already_transitioned` rather than
 * an error — safe under retry, safe under concurrent workers, no
 * additional locking needed (unlike `AutonomyPolicy`'s lazy-create race,
 * there is no row to race into existence here).
 */
export async function expireStaleOpportunity(input: ExpireStaleOpportunityInput): Promise<ExpireStaleOpportunityResult> {
  const scoped = getTenantScopedClient(input.organizationId);

  const opportunity = await scoped.opportunity.findFirst({ where: { id: input.opportunityId } });
  if (!opportunity) {
    return { expired: false, reason: "not_found" };
  }

  if (opportunity.ruleName !== RULE_NAME || opportunity.ruleVersion !== RULE_VERSION) {
    return { expired: false, reason: "unsupported_rule" };
  }

  if (opportunity.status !== "new") {
    return { expired: false, reason: "not_eligible_status", currentStatus: opportunity.status };
  }

  if (opportunity.relatedEntityType !== "Lead" || !opportunity.relatedEntityId) {
    return { expired: false, reason: "missing_related_entity" };
  }

  const isStale = await isRelatedLeadNoLongerEligible(input.organizationId, opportunity.relatedEntityId);
  if (!isStale) {
    return { expired: false, reason: "still_active" };
  }

  const { count, auditEntry } = await prisma.$transaction(async (tx) => {
    const updateResult = await tx.opportunity.updateMany({
      where: { id: opportunity.id, organizationId: input.organizationId, status: "new" },
      data: { status: "expired" },
    });
    if (updateResult.count === 0) {
      return { count: 0, auditEntry: null };
    }

    const auditEntry = await recordAuditLog(
      {
        organizationId: input.organizationId,
        actorId: input.actorId,
        actorType: "ai",
        action: "opportunity.ai_expired",
        targetType: "opportunity",
        targetId: opportunity.id,
        metadata: {
          ruleName: opportunity.ruleName,
          ruleVersion: opportunity.ruleVersion,
          relatedEntityType: opportunity.relatedEntityType,
          relatedEntityId: opportunity.relatedEntityId,
          previousStatus: "new",
        },
      },
      tx,
    );

    return { count: updateResult.count, auditEntry };
  });

  if (count === 0) {
    // A concurrent call (or a retry after one already succeeded) got there first.
    return { expired: false, reason: "already_transitioned" };
  }

  if (auditEntry) await publishAuditEvent(auditEntry);
  return { expired: true, opportunityId: opportunity.id };
}

/**
 * Re-derives "is this Lead still a valid reason to keep this Opportunity
 * open" from scratch — never trusts the Opportunity's own stored evidence,
 * which may be arbitrarily old. Reuses the exact scanner logic
 * (`scanOrganizationForStalledLeads` in
 * `src/server/intelligence/signals/scanner.ts`) for the org-median
 * computation and staleness evaluation, so this can never diverge from
 * what the scanner itself would currently detect.
 */
async function isRelatedLeadNoLongerEligible(organizationId: string, leadId: string): Promise<boolean> {
  const scoped = getTenantScopedClient(organizationId);

  const lead = await scoped.lead.findFirst({
    where: { id: leadId },
    select: {
      id: true,
      value: true,
      createdAt: true,
      deletedAt: true,
      stage: { select: { isWon: true, isLost: true } },
      activities: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
    },
  });

  if (!lead) return true; // hard-deleted or never existed
  if (lead.deletedAt) return true; // soft-deleted
  if (lead.stage.isWon || lead.stage.isLost) return true; // closed

  const openLeads = await scoped.lead.findMany({
    where: { deletedAt: null, stage: { isWon: false, isLost: false } },
    select: { value: true },
  });
  const orgMedianOpenValue = medianOpenLeadValue(openLeads.map((l) => Number(l.value)));

  const evaluation = evaluateHighValueStalledLead(
    {
      id: lead.id,
      value: Number(lead.value),
      createdAt: lead.createdAt,
      isWon: false,
      isLost: false,
      lastActivityAt: lead.activities[0]?.createdAt ?? null,
    },
    orgMedianOpenValue,
  );

  return evaluation === null;
}
