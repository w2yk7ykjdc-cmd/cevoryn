import { prisma } from "@/server/db/client";
import { recordHealthSnapshot } from "@/server/intelligence/health/service";
import { generateOpportunitiesForOrganization } from "@/server/intelligence/opportunity/service";
import { generateRisksForOrganization } from "@/server/intelligence/risk/service";
import { logger } from "@/server/logger/logger";

const ORG_BATCH_SIZE = 50;

export type ComputeCompanyIntelligenceResult = {
  organizationsScanned: number;
  opportunitiesCreated: number;
  opportunitiesUpdated: number;
  risksCreated: number;
  risksUpdated: number;
  risksResolved: number;
  errors: number;
  durationMs: number;
};

/**
 * The recurring "compute intelligence" pass: for every organization, records
 * a fresh Sales Health snapshot and refreshes its Opportunities and Risks
 * from the signal ledger. All three are paged together, in one pass over
 * organizations (rather than three independent full scans), mirroring
 * `scanCompanySignals`'s cursor-paging and per-organization isolation
 * (`src/server/intelligence/signals/scanner.ts`) — one organization's
 * failure is logged and skipped, never aborting the run for the rest.
 */
export async function computeCompanyIntelligence(): Promise<ComputeCompanyIntelligenceResult> {
  const start = Date.now();
  let cursor: string | undefined;
  let organizationsScanned = 0;
  let opportunitiesCreated = 0;
  let opportunitiesUpdated = 0;
  let risksCreated = 0;
  let risksUpdated = 0;
  let risksResolved = 0;
  let errors = 0;

  for (;;) {
    const organizations = await prisma.organization.findMany({
      take: ORG_BATCH_SIZE,
      orderBy: { id: "asc" },
      select: { id: true },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (organizations.length === 0) break;

    for (const organization of organizations) {
      try {
        await recordHealthSnapshot(organization.id);
        const opportunityResult = await generateOpportunitiesForOrganization(organization.id);
        const riskResult = await generateRisksForOrganization(organization.id);
        organizationsScanned += 1;
        opportunitiesCreated += opportunityResult.opportunitiesCreated;
        opportunitiesUpdated += opportunityResult.opportunitiesUpdated;
        risksCreated += riskResult.risksCreated;
        risksUpdated += riskResult.risksUpdated;
        risksResolved += riskResult.risksResolved;
      } catch (err) {
        errors += 1;
        logger.error({ err, organizationId: organization.id }, "company intelligence computation failed for organization");
      }
    }

    cursor = organizations[organizations.length - 1]?.id;
    if (organizations.length < ORG_BATCH_SIZE) break;
  }

  const durationMs = Date.now() - start;
  logger.info(
    { organizationsScanned, opportunitiesCreated, opportunitiesUpdated, risksCreated, risksUpdated, risksResolved, errors, durationMs },
    "company intelligence computation completed",
  );

  return {
    organizationsScanned,
    opportunitiesCreated,
    opportunitiesUpdated,
    risksCreated,
    risksUpdated,
    risksResolved,
    errors,
    durationMs,
  };
}
