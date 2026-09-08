import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { getTenantScopedClient } from "@/server/db/tenant";
import { RULE_NAME, RULE_VERSION } from "@/server/intelligence/signals/rules/high-value-stalled-lead";
import { generateHighValueStalledLeadOpportunity } from "@/server/intelligence/opportunity/rules/high-value-stalled-lead";
import type { ListOpportunitiesInput } from "@/server/intelligence/opportunity/types";

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
