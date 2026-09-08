import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { getTenantScopedClient } from "@/server/db/tenant";
import { generateAtRiskSubscriptionRisk, RULE_NAME, RULE_VERSION } from "@/server/intelligence/risk/rules/at-risk-subscription";
import type { ListRisksInput } from "@/server/intelligence/risk/types";

export type GenerateRisksResult = {
  signalsEvaluated: number;
  risksCreated: number;
  risksUpdated: number;
  risksResolved: number;
};

/**
 * Generates/refreshes Risks for one organization from its
 * `billing.subscription_updated` CompanySignal rows — V1's only rule.
 * Reads signals rather than re-deriving billing health, for the same
 * "signal ledger is the single source of truth" reason
 * `generateOpportunitiesForOrganization` does (see
 * `src/server/intelligence/opportunity/service.ts`).
 *
 * Unlike Opportunity, a Risk auto-resolves: when the signal's severity is
 * no longer "high" (the subscription recovered — `recordSignal` upserts
 * the same row per `subscriptionId`, so a healthy update already refreshes
 * severity down), any existing `open` Risk for that subscription is
 * transitioned to `resolved` automatically. A human's `dismissed` is never
 * touched either way — this mirrors the Sprint 5 subscriber's own doc
 * comment, which flagged "auto-resolution... a reconciliation concern for
 * the future Risk Engine" as deliberately out of scope back then.
 *
 * Upserts on the same `[organizationId, ruleName, ruleVersion,
 * relatedEntityType, relatedEntityId]` shape `CompanySignal`/`Opportunity`
 * use, via the raw `prisma` client for the identical reason `recordSignal`
 * does (the tenant-scoping extension does not intercept `upsert` — see
 * `src/server/db/tenant.ts`).
 */
export async function generateRisksForOrganization(organizationId: string): Promise<GenerateRisksResult> {
  const scoped = getTenantScopedClient(organizationId);

  const billingSignals = await scoped.companySignal.findMany({
    where: { ruleName: "billing.subscription_updated", relatedEntityType: "Subscription" },
  });

  let risksCreated = 0;
  let risksUpdated = 0;
  let risksResolved = 0;

  for (const signal of billingSignals) {
    if (!signal.relatedEntityId) continue;

    const key = {
      organizationId_ruleName_ruleVersion_relatedEntityType_relatedEntityId: {
        organizationId,
        ruleName: RULE_NAME,
        ruleVersion: RULE_VERSION,
        relatedEntityType: "Subscription",
        relatedEntityId: signal.relatedEntityId,
      },
    };

    const isAtRisk = signal.severity === "high";
    const existing = await prisma.risk.findUnique({ where: key });

    if (!isAtRisk) {
      if (existing && existing.status === "open") {
        await prisma.risk.update({ where: { id: existing.id }, data: { status: "resolved", resolvedAt: new Date() } });
        risksResolved += 1;
      }
      continue;
    }

    const subscription = await scoped.subscription.findFirst({
      where: { id: signal.relatedEntityId },
      select: { plan: { select: { monthlyPriceCents: true } } },
    });
    if (!subscription) continue; // subscription deleted/replaced since the signal was recorded — nothing to act on

    const payload = signal.payload as { status?: string };
    const generated = generateAtRiskSubscriptionRisk({
      subscriptionId: signal.relatedEntityId,
      status: payload.status ?? "unknown",
      monthlyPriceCents: subscription.plan.monthlyPriceCents,
      signalSeverity: signal.severity,
      signalConfidence: signal.confidence,
      signalId: signal.id,
    });

    await prisma.risk.upsert({
      where: key,
      create: {
        organizationId,
        type: generated.type,
        title: generated.title,
        description: generated.description,
        severity: generated.severity,
        confidence: generated.confidence,
        potentialLoss: generated.potentialLoss,
        evidence: generated.evidence as Prisma.InputJsonValue,
        explanation: generated.explanation,
        relatedEntityType: generated.relatedEntityType,
        relatedEntityId: generated.relatedEntityId,
        sourceSignalId: generated.sourceSignalId,
        ruleName: generated.ruleName,
        ruleVersion: generated.ruleVersion,
      },
      update: {
        // status/resolvedAt intentionally not overwritten here -- see the Risk model's doc comment
        title: generated.title,
        description: generated.description,
        severity: generated.severity,
        confidence: generated.confidence,
        potentialLoss: generated.potentialLoss,
        evidence: generated.evidence as Prisma.InputJsonValue,
        explanation: generated.explanation,
        sourceSignalId: generated.sourceSignalId,
        detectedAt: new Date(),
      },
    });

    if (existing) risksUpdated += 1;
    else risksCreated += 1;
  }

  return { signalsEvaluated: billingSignals.length, risksCreated, risksUpdated, risksResolved };
}

/** Paginated, filterable read path — mirrors `listOpportunities`'s shape. */
export async function listRisks(input: ListRisksInput) {
  const scoped = getTenantScopedClient(input.organizationId);
  const limit = Math.min(input.limit ?? 50, 200);

  const risks = await scoped.risk.findMany({
    where: { status: input.status },
    orderBy: [{ severity: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });

  const hasMore = risks.length > limit;
  const page = hasMore ? risks.slice(0, limit) : risks;

  return { risks: page, nextCursor: hasMore ? page[page.length - 1]?.id : null };
}
