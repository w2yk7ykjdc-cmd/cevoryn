import { prisma } from "@/server/db/client";
import { getTenantScopedClient } from "@/server/db/tenant";
import { logger } from "@/server/logger/logger";
import { recordSignal } from "@/server/intelligence/signals/service";
import { METRICS_SNAPSHOT_RULE_NAME, METRICS_SNAPSHOT_RULE_VERSION } from "@/server/intelligence/signals/market-scanner";
import { RULE_NAME as REGIME_RULE_NAME, RULE_VERSION as REGIME_RULE_VERSION } from "@/server/intelligence/signals/rules/market-regime";
import { RULE_NAME as OPPORTUNITY_RULE_NAME, RULE_VERSION as OPPORTUNITY_RULE_VERSION } from "@/server/intelligence/opportunity/rules/market-multi-signal";
import { RULE_NAME as RISK_RULE_NAME, RULE_VERSION as RISK_RULE_VERSION } from "@/server/intelligence/risk/rules/market-multi-signal";
import { selectStrategy } from "@/server/intelligence/strategy/scoring";
import type { MarketMetricsSnapshotPayload, StrategyInput } from "@/server/intelligence/strategy/types";
import { DAILY_INTERVAL } from "@/server/market-data/types";

const ORG_BATCH_SIZE = 50;

/** Sprint 15's own signal identity, distinct from `market_metrics_snapshot`/the 5 Sprint 14 signal families — a strategy candidate is a derived DECISION, not a raw observation. */
export const STRATEGY_CANDIDATE_RULE_NAME = "market_strategy_candidate";
export const STRATEGY_CANDIDATE_RULE_VERSION = "v1";

export type GenerateMarketStrategiesResult = {
  organizationsScanned: number;
  candidatesCreated: number;
  candidatesUpdated: number;
  noTradeCount: number;
  errors: number;
  durationMs: number;
};

/**
 * Stage 3 of the market intelligence pipeline (stage 1: `ingestMarketData`;
 * stage 2: `generateMarketIntelligence`). Reads back what stages 1 and 2
 * already computed and persisted — the `market_metrics_snapshot.v1`
 * `CompanySignal` per symbol, the GLOBAL `market_regime` `CompanySignal`,
 * and this symbol's own `Opportunity`/`Risk` rows if any exist — and NEVER
 * calls Binance or recomputes any metric. Turns that already-known evidence
 * into a deterministic `StrategyCandidate` per symbol (`selectStrategy`,
 * `strategy/scoring.ts`), including the explicit `NO_TRADE` conclusion when
 * nothing qualifies, and persists it as its own `market_strategy_candidate.v1`
 * `CompanySignal` — the SAME bridge-signal pattern `market_metrics_snapshot`
 * already established, not a new pipeline or a new Prisma model. Mirrors
 * `generateMarketIntelligence`'s exact cursor-paged, per-organization-
 * isolated shape.
 */
export async function generateMarketStrategies(): Promise<GenerateMarketStrategiesResult> {
  const start = Date.now();
  let cursor: string | undefined;
  let organizationsScanned = 0;
  let candidatesCreated = 0;
  let candidatesUpdated = 0;
  let noTradeCount = 0;
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
        const result = await generateMarketStrategiesForOrganization(organization.id);
        organizationsScanned += 1;
        candidatesCreated += result.candidatesCreated;
        candidatesUpdated += result.candidatesUpdated;
        noTradeCount += result.noTradeCount;
      } catch (err) {
        errors += 1;
        logger.error({ err, organizationId: organization.id }, "market strategy generation failed for organization");
      }
    }

    cursor = organizations[organizations.length - 1]?.id;
    if (organizations.length < ORG_BATCH_SIZE) break;
  }

  const durationMs = Date.now() - start;
  logger.info(
    { organizationsScanned, candidatesCreated, candidatesUpdated, noTradeCount, errors, durationMs },
    "market strategy generation completed",
  );

  return { organizationsScanned, candidatesCreated, candidatesUpdated, noTradeCount, errors, durationMs };
}

async function generateMarketStrategiesForOrganization(
  organizationId: string,
): Promise<{ candidatesCreated: number; candidatesUpdated: number; noTradeCount: number }> {
  const scoped = getTenantScopedClient(organizationId);

  const [snapshots, regimeSignal] = await Promise.all([
    scoped.companySignal.findMany({
      where: { ruleName: METRICS_SNAPSHOT_RULE_NAME, ruleVersion: METRICS_SNAPSHOT_RULE_VERSION, status: "active" },
      select: { relatedEntityId: true, payload: true },
    }),
    scoped.companySignal.findFirst({
      where: { ruleName: REGIME_RULE_NAME, ruleVersion: REGIME_RULE_VERSION, relatedEntityId: "GLOBAL" },
      select: { payload: true },
    }),
  ]);

  const regimePayload = regimeSignal?.payload as { regime?: string } | undefined;
  const regime = regimePayload?.regime ?? null;

  let candidatesCreated = 0;
  let candidatesUpdated = 0;
  let noTradeCount = 0;

  for (const snapshot of snapshots) {
    if (!snapshot.relatedEntityId) continue;
    const metrics = snapshot.payload as unknown as MarketMetricsSnapshotPayload;
    const symbol = snapshot.relatedEntityId;

    // Raw client, same pattern `generateMarketIntelligence` (stage 2) already
    // uses: the composite unique key includes `organizationId` explicitly,
    // so tenant scoping is preserved without needing the extension.
    const [opportunityRow, riskRow] = await Promise.all([
      prisma.opportunity.findUnique({
        where: {
          organizationId_ruleName_ruleVersion_relatedEntityType_relatedEntityId: {
            organizationId,
            ruleName: OPPORTUNITY_RULE_NAME,
            ruleVersion: OPPORTUNITY_RULE_VERSION,
            relatedEntityType: "MarketSymbol",
            relatedEntityId: symbol,
          },
        },
        select: { id: true, score: true, confidence: true, status: true },
      }),
      prisma.risk.findUnique({
        where: {
          organizationId_ruleName_ruleVersion_relatedEntityType_relatedEntityId: {
            organizationId,
            ruleName: RISK_RULE_NAME,
            ruleVersion: RISK_RULE_VERSION,
            relatedEntityType: "MarketSymbol",
            relatedEntityId: symbol,
          },
        },
        select: { id: true, severity: true, status: true, evidence: true },
      }),
    ]);

    const riskConditions = riskRow ? ((riskRow.evidence as { conditions?: string[] } | null)?.conditions ?? []) : [];

    const input: StrategyInput = {
      metrics,
      regime,
      opportunity:
        opportunityRow && opportunityRow.status !== "dismissed" && opportunityRow.status !== "expired"
          ? { id: opportunityRow.id, score: opportunityRow.score, confidence: opportunityRow.confidence }
          : null,
      risk: riskRow && riskRow.status === "open" ? { id: riskRow.id, severity: riskRow.severity, conditions: riskConditions } : null,
    };

    const candidate = selectStrategy(input);
    if (candidate.strategyType === "NO_TRADE") noTradeCount += 1;

    const severity = severityForCandidate(candidate.score, candidate.strategyType);

    const { outcome } = await recordSignal({
      organizationId,
      type: STRATEGY_CANDIDATE_RULE_NAME,
      sourceType: "scanner",
      sourceId: `${symbol}:${DAILY_INTERVAL}`,
      severity,
      confidence: candidate.confidence,
      ruleName: STRATEGY_CANDIDATE_RULE_NAME,
      ruleVersion: STRATEGY_CANDIDATE_RULE_VERSION,
      relatedEntityType: "MarketSymbol",
      relatedEntityId: symbol,
      payload: candidate,
    });

    if (outcome === "created") candidatesCreated += 1;
    else candidatesUpdated += 1;
  }

  return { candidatesCreated, candidatesUpdated, noTradeCount };
}

/** Reuses the `SignalSeverity` enum as "how noteworthy this candidate is," the same domain-reinterpretation `market_regime`'s own severity field already applies -- never literal risk severity. */
function severityForCandidate(score: number, strategyType: string): "low" | "medium" | "high" {
  if (strategyType === "NO_TRADE") return "low";
  if (score >= 70) return "high";
  if (score >= 45) return "medium";
  return "low";
}
