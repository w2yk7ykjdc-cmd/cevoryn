import "server-only";

import { hasFeature } from "@/features/billing/config/plans";
import { prisma } from "@/lib/prisma";
import { getOrganizationPlan } from "@/server/services/entitlement.service";

import { extractEventsForOrganization } from "./events/event-extractor";
import { createNotification } from "./notifications/notification.service";
import { generateOpportunitiesForOrganization } from "./opportunities/opportunity-generator";
import { ingestSignalsForOrganization } from "./signals/ingestion.service";

export interface RadarPipelineResult {
  organizationId: string;
  signalsIngested: number;
  eventsCreated: number;
  opportunitiesCreated: number;
  errors: string[];
}

/**
 * Runs the full Signal -> Event -> Opportunity -> Notification pipeline
 * for one organization. Each stage is independently try/caught: a failure
 * in one stage is recorded in `errors` and does not prevent later stages
 * from at least attempting to run against whatever the earlier stage
 * already committed to the database (ingestion writes signals row-by-row,
 * so a later failure never loses already-ingested data).
 */
export async function runRadarPipelineForOrganization(
  organizationId: string
): Promise<RadarPipelineResult> {
  const errors: string[] = [];
  let signalsIngested = 0;
  let eventsCreated = 0;
  let opportunitiesCreated = 0;

  try {
    const ingestionResults = await ingestSignalsForOrganization(organizationId);
    signalsIngested = ingestionResults.reduce((sum, r) => sum + r.created, 0);
    for (const result of ingestionResults) {
      errors.push(
        ...result.adapterErrors.map(
          (e) => `ingestion(${result.entityName}): ${e}`
        )
      );
    }
  } catch (error) {
    errors.push(
      `ingestion: ${error instanceof Error ? error.message : "unknown error"}`
    );
  }

  try {
    const eventResult = await extractEventsForOrganization(organizationId);
    eventsCreated = eventResult.eventsCreated;
  } catch (error) {
    errors.push(
      `event-extraction: ${error instanceof Error ? error.message : "unknown error"}`
    );
  }

  try {
    const opportunityResult =
      await generateOpportunitiesForOrganization(organizationId);
    opportunitiesCreated = opportunityResult.opportunitiesCreated.length;

    for (const opportunityId of opportunityResult.opportunitiesCreated) {
      await notifyNewOpportunity(organizationId, opportunityId);
    }
  } catch (error) {
    errors.push(
      `opportunity-generation: ${error instanceof Error ? error.message : "unknown error"}`
    );
  }

  return {
    organizationId,
    signalsIngested,
    eventsCreated,
    opportunitiesCreated,
    errors,
  };
}

async function notifyNewOpportunity(
  organizationId: string,
  opportunityId: string
): Promise<void> {
  const opportunity = await prisma.opportunity.findFirst({
    where: { id: opportunityId, organizationId },
    select: { id: true, title: true, description: true, polarity: true },
  });
  if (!opportunity) return;

  const isThreat = opportunity.polarity === "THREAT";
  await createNotification({
    organizationId,
    type: isThreat ? "THREAT_DETECTED" : "NEW_OPPORTUNITY",
    title: isThreat
      ? `Threat detected: ${opportunity.title}`
      : `New opportunity: ${opportunity.title}`,
    body: opportunity.description,
    entityType: "opportunity",
    entityId: opportunity.id,
  });
}

/**
 * Runs the pipeline for every organization that has both RADAR plan access
 * and at least one active watchlist entity - skipping the (likely common)
 * case of an org with no watchlist keeps this from doing pointless work on
 * every tenant on every cron tick.
 */
export async function runRadarPipelineForAllOrganizations(): Promise<
  RadarPipelineResult[]
> {
  const organizations = await prisma.organization.findMany({
    where: { externalEntities: { some: { isActive: true } } },
    select: { id: true },
  });

  const results: RadarPipelineResult[] = [];
  for (const organization of organizations) {
    const plan = await getOrganizationPlan(organization.id);
    if (!hasFeature(plan, "RADAR")) continue;

    results.push(await runRadarPipelineForOrganization(organization.id));
  }

  return results;
}
