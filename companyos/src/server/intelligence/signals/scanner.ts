import { prisma } from "@/server/db/client";
import { getTenantScopedClient } from "@/server/db/tenant";
import { recordSignal } from "@/server/intelligence/signals/service";
import {
  RULE_NAME,
  RULE_VERSION,
  evaluateHighValueStalledLead,
  medianOpenLeadValue,
} from "@/server/intelligence/signals/rules/high-value-stalled-lead";
import { logger } from "@/server/logger/logger";

const ORG_BATCH_SIZE = 50;

export type ScanCompanySignalsResult = {
  organizationsScanned: number;
  recordsScanned: number;
  signalsCreated: number;
  signalsUpdated: number;
  errors: number;
  durationMs: number;
};

/**
 * Applies `high_value_stalled_lead` across every organization's open leads.
 * Organizations are paged with a cursor (never loaded all at once), and
 * each organization is evaluated independently inside its own try/catch —
 * one organization's failure is logged and skipped, never aborting the run
 * for the rest. `recordSignal`'s upsert makes re-running this scan
 * idempotent: a lead that's still stalled on the next pass refreshes its
 * existing signal rather than creating a duplicate.
 */
export async function scanCompanySignals(): Promise<ScanCompanySignalsResult> {
  const start = Date.now();
  let cursor: string | undefined;
  let organizationsScanned = 0;
  let recordsScanned = 0;
  let signalsCreated = 0;
  let signalsUpdated = 0;
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
        const result = await scanOrganizationForStalledLeads(organization.id);
        organizationsScanned += 1;
        recordsScanned += result.recordsScanned;
        signalsCreated += result.signalsCreated;
        signalsUpdated += result.signalsUpdated;
      } catch (err) {
        errors += 1;
        logger.error({ err, organizationId: organization.id }, "company signal scan failed for organization");
      }
    }

    cursor = organizations[organizations.length - 1]?.id;
    if (organizations.length < ORG_BATCH_SIZE) break;
  }

  const durationMs = Date.now() - start;
  logger.info(
    { organizationsScanned, recordsScanned, signalsCreated, signalsUpdated, errors, durationMs },
    "company signal scan completed",
  );

  return { organizationsScanned, recordsScanned, signalsCreated, signalsUpdated, errors, durationMs };
}

async function scanOrganizationForStalledLeads(
  organizationId: string,
): Promise<{ recordsScanned: number; signalsCreated: number; signalsUpdated: number }> {
  const scoped = getTenantScopedClient(organizationId);

  const openLeads = await scoped.lead.findMany({
    where: { deletedAt: null, stage: { isWon: false, isLost: false } },
    select: {
      id: true,
      value: true,
      createdAt: true,
      stage: { select: { isWon: true, isLost: true } },
      activities: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
    },
  });

  const orgMedianOpenValue = medianOpenLeadValue(openLeads.map((lead) => Number(lead.value)));

  let signalsCreated = 0;
  let signalsUpdated = 0;

  for (const lead of openLeads) {
    const evaluation = evaluateHighValueStalledLead(
      {
        id: lead.id,
        value: Number(lead.value),
        createdAt: lead.createdAt,
        isWon: lead.stage.isWon,
        isLost: lead.stage.isLost,
        lastActivityAt: lead.activities[0]?.createdAt ?? null,
      },
      orgMedianOpenValue,
    );
    if (!evaluation) continue;

    const { outcome } = await recordSignal({
      organizationId,
      type: RULE_NAME,
      sourceType: "scanner",
      sourceId: lead.id,
      severity: evaluation.severity,
      confidence: evaluation.confidence,
      ruleName: RULE_NAME,
      ruleVersion: RULE_VERSION,
      relatedEntityType: "Lead",
      relatedEntityId: lead.id,
      payload: evaluation.evidence,
    });

    if (outcome === "created") signalsCreated += 1;
    else signalsUpdated += 1;
  }

  return { recordsScanned: openLeads.length, signalsCreated, signalsUpdated };
}
