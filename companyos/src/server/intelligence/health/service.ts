import type { Prisma } from "@prisma/client";
import { getTenantScopedClient } from "@/server/db/tenant";
import {
  SALES_HEALTH_RULE_VERSION,
  computeSalesHealthEvidence,
  computeSalesHealthScore,
} from "@/server/intelligence/health/sales-health";

/**
 * Computes the current Sales Health score for an organization and persists
 * it as a new `CompanyHealthSnapshot` row. Unlike the `CompanySignal`
 * ledger (which upserts one row per detected condition), snapshots are an
 * append-only time series — each call records a fresh point in time rather
 * than overwriting the last one, so trend-over-time queries stay possible.
 */
export async function recordHealthSnapshot(organizationId: string) {
  const scoped = getTenantScopedClient(organizationId);
  const evidence = await computeSalesHealthEvidence(organizationId);
  const salesHealthScore = computeSalesHealthScore(evidence);

  return scoped.companyHealthSnapshot.create({
    data: {
      organizationId,
      salesHealthScore,
      evidence: evidence as unknown as Prisma.InputJsonValue,
      ruleVersion: SALES_HEALTH_RULE_VERSION,
    },
  });
}

/** Most recent snapshot for an organization, or `null` if none exist yet. */
export async function getLatestHealthSnapshot(organizationId: string) {
  const scoped = getTenantScopedClient(organizationId);
  return scoped.companyHealthSnapshot.findFirst({
    where: {},
    orderBy: [{ computedAt: "desc" }, { id: "desc" }],
  });
}
