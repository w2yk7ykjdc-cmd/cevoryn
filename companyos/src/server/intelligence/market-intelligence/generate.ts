import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { getTenantScopedClient } from "@/server/db/tenant";
import { logger } from "@/server/logger/logger";
import { METRICS_SNAPSHOT_RULE_NAME, METRICS_SNAPSHOT_RULE_VERSION, type MarketMetricsSnapshotPayload } from "@/server/intelligence/signals/market-scanner";
import { computeMarketConfidence, computeOpportunityScore, evaluateMarketOpportunityEligibility, evaluateMarketRiskConditions } from "@/server/intelligence/market-intelligence/scoring";
import { buildMarketOpportunity, RULE_NAME as OPPORTUNITY_RULE_NAME, RULE_VERSION as OPPORTUNITY_RULE_VERSION } from "@/server/intelligence/opportunity/rules/market-multi-signal";
import { buildMarketRisk, RULE_NAME as RISK_RULE_NAME, RULE_VERSION as RISK_RULE_VERSION } from "@/server/intelligence/risk/rules/market-multi-signal";

const ORG_BATCH_SIZE = 50;

/** Fixed: risk conditions are deterministic booleans (triggered or not), not a continuous margin like opportunity eligibility -- see `computeMarketConfidence`'s own doc comment for why that one IS margin-based. */
const RISK_CONFIDENCE = 90;

export type GenerateMarketIntelligenceResult = {
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
 * Stage 2 of the market intelligence pipeline (stage 1:
 * `ingestMarketData`, `market-scanner.ts`) — mirrors
 * `compute-company-intelligence`'s exact cursor-paged, per-organization-
 * isolated shape. Reads back each organization's own
 * `market_metrics_snapshot` `CompanySignal` rows (written unconditionally
 * by stage 1) rather than refetching Binance or recomputing anything —
 * the two stages communicate purely through the existing `CompanySignal`
 * ledger, no new pipeline. Deterministic multi-signal eligibility (never a
 * single metric alone) decides Opportunity candidacy; risk conditions are
 * evaluated independently and can co-occur with an opportunity (feeding
 * its risk penalty) or stand alone. Upserts through the EXISTING
 * `Opportunity`/`Risk` models on their own established idempotency key —
 * no parallel intelligence pipeline, no bypass.
 */
export async function generateMarketIntelligence(): Promise<GenerateMarketIntelligenceResult> {
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
        const result = await generateMarketIntelligenceForOrganization(organization.id);
        organizationsScanned += 1;
        opportunitiesCreated += result.opportunitiesCreated;
        opportunitiesUpdated += result.opportunitiesUpdated;
        risksCreated += result.risksCreated;
        risksUpdated += result.risksUpdated;
        risksResolved += result.risksResolved;
      } catch (err) {
        errors += 1;
        logger.error({ err, organizationId: organization.id }, "market intelligence generation failed for organization");
      }
    }

    cursor = organizations[organizations.length - 1]?.id;
    if (organizations.length < ORG_BATCH_SIZE) break;
  }

  const durationMs = Date.now() - start;
  logger.info(
    { organizationsScanned, opportunitiesCreated, opportunitiesUpdated, risksCreated, risksUpdated, risksResolved, errors, durationMs },
    "market intelligence generation completed",
  );

  return { organizationsScanned, opportunitiesCreated, opportunitiesUpdated, risksCreated, risksUpdated, risksResolved, errors, durationMs };
}

async function generateMarketIntelligenceForOrganization(organizationId: string): Promise<{
  opportunitiesCreated: number;
  opportunitiesUpdated: number;
  risksCreated: number;
  risksUpdated: number;
  risksResolved: number;
}> {
  const scoped = getTenantScopedClient(organizationId);
  const snapshots = await scoped.companySignal.findMany({
    where: { ruleName: METRICS_SNAPSHOT_RULE_NAME, ruleVersion: METRICS_SNAPSHOT_RULE_VERSION, status: "active" },
    select: { relatedEntityId: true, payload: true },
  });

  let opportunitiesCreated = 0;
  let opportunitiesUpdated = 0;
  let risksCreated = 0;
  let risksUpdated = 0;
  let risksResolved = 0;

  for (const snapshot of snapshots) {
    if (!snapshot.relatedEntityId) continue;
    const metrics = snapshot.payload as unknown as MarketMetricsSnapshotPayload;

    const riskKey = {
      organizationId_ruleName_ruleVersion_relatedEntityType_relatedEntityId: {
        organizationId,
        ruleName: RISK_RULE_NAME,
        ruleVersion: RISK_RULE_VERSION,
        relatedEntityType: "MarketSymbol",
        relatedEntityId: metrics.symbol,
      },
    };
    const existingRisk = await prisma.risk.findUnique({ where: riskKey });
    const riskEvaluation = evaluateMarketRiskConditions(metrics);

    if (riskEvaluation) {
      const generatedRisk = buildMarketRisk(metrics, riskEvaluation.conditions, riskEvaluation.severity, RISK_CONFIDENCE);
      await prisma.risk.upsert({
        where: riskKey,
        create: {
          organizationId,
          type: generatedRisk.type,
          title: generatedRisk.title,
          description: generatedRisk.description,
          severity: generatedRisk.severity,
          confidence: generatedRisk.confidence,
          potentialLoss: generatedRisk.potentialLoss,
          evidence: generatedRisk.evidence as Prisma.InputJsonValue,
          explanation: generatedRisk.explanation,
          relatedEntityType: generatedRisk.relatedEntityType,
          relatedEntityId: generatedRisk.relatedEntityId,
          ruleName: generatedRisk.ruleName,
          ruleVersion: generatedRisk.ruleVersion,
        },
        update: {
          // status/resolvedAt intentionally not overwritten -- mirrors at-risk-subscription's own precedent
          title: generatedRisk.title,
          description: generatedRisk.description,
          severity: generatedRisk.severity,
          confidence: generatedRisk.confidence,
          evidence: generatedRisk.evidence as Prisma.InputJsonValue,
          explanation: generatedRisk.explanation,
          detectedAt: new Date(),
        },
      });
      if (existingRisk) risksUpdated += 1;
      else risksCreated += 1;
    } else if (existingRisk && existingRisk.status === "open") {
      await prisma.risk.update({ where: { id: existingRisk.id }, data: { status: "resolved", resolvedAt: new Date() } });
      risksResolved += 1;
    }

    if (evaluateMarketOpportunityEligibility(metrics)) {
      const scoreResult = computeOpportunityScore(metrics, riskEvaluation !== null);
      const confidence = computeMarketConfidence(metrics);
      const generatedOpportunity = buildMarketOpportunity(metrics, scoreResult, confidence, riskEvaluation !== null);

      const opportunityKey = {
        organizationId_ruleName_ruleVersion_relatedEntityType_relatedEntityId: {
          organizationId,
          ruleName: OPPORTUNITY_RULE_NAME,
          ruleVersion: OPPORTUNITY_RULE_VERSION,
          relatedEntityType: "MarketSymbol",
          relatedEntityId: metrics.symbol,
        },
      };
      const existingOpportunity = await prisma.opportunity.findUnique({ where: opportunityKey, select: { id: true } });

      await prisma.opportunity.upsert({
        where: opportunityKey,
        create: {
          organizationId,
          type: generatedOpportunity.type,
          title: generatedOpportunity.title,
          description: generatedOpportunity.description,
          score: generatedOpportunity.score,
          confidence: generatedOpportunity.confidence,
          potentialImpact: generatedOpportunity.potentialImpact,
          effort: generatedOpportunity.effort,
          urgency: generatedOpportunity.urgency,
          risk: generatedOpportunity.risk,
          evidence: generatedOpportunity.evidence as Prisma.InputJsonValue,
          explanation: generatedOpportunity.explanation,
          relatedEntityType: generatedOpportunity.relatedEntityType,
          relatedEntityId: generatedOpportunity.relatedEntityId,
          ruleName: generatedOpportunity.ruleName,
          ruleVersion: generatedOpportunity.ruleVersion,
        },
        update: {
          // status intentionally not overwritten -- a human's own triage decision is never silently reset
          title: generatedOpportunity.title,
          description: generatedOpportunity.description,
          score: generatedOpportunity.score,
          confidence: generatedOpportunity.confidence,
          urgency: generatedOpportunity.urgency,
          risk: generatedOpportunity.risk,
          evidence: generatedOpportunity.evidence as Prisma.InputJsonValue,
          explanation: generatedOpportunity.explanation,
          detectedAt: new Date(),
        },
      });
      if (existingOpportunity) opportunitiesUpdated += 1;
      else opportunitiesCreated += 1;
    }
  }

  return { opportunitiesCreated, opportunitiesUpdated, risksCreated, risksUpdated, risksResolved };
}
