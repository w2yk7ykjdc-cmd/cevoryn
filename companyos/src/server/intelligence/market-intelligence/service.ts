import { getTenantScopedClient } from "@/server/db/tenant";
import { rankMarketCandidates } from "@/server/intelligence/market-intelligence/ranking";
import { RULE_NAME as OPPORTUNITY_RULE_NAME, RULE_VERSION as OPPORTUNITY_RULE_VERSION } from "@/server/intelligence/opportunity/rules/market-multi-signal";
import { RULE_NAME as RISK_RULE_NAME, RULE_VERSION as RISK_RULE_VERSION } from "@/server/intelligence/risk/rules/market-multi-signal";
import { RULE_NAME as REGIME_RULE_NAME, RULE_VERSION as REGIME_RULE_VERSION } from "@/server/intelligence/signals/rules/market-regime";
import type { RankedMarketCandidate } from "@/server/intelligence/market-intelligence/types";

export type MarketIntelligenceSnapshot = {
  regime: string | null;
  regimeObservedAt: string | null;
  ranked: RankedMarketCandidate[];
};

/**
 * The single read-only entry point Sprint 14's AI tool and UI page both
 * call. Reads only what `generateMarketIntelligence` (stage 2) already
 * persisted through the existing `Opportunity`/`Risk` models plus the
 * regime `CompanySignal` stage 1 writes — never recomputes anything,
 * never calls Binance, never calls an LLM.
 */
export async function getMarketIntelligenceRanking(organizationId: string): Promise<MarketIntelligenceSnapshot> {
  const scoped = getTenantScopedClient(organizationId);

  const [opportunities, risks, regimeSignal] = await Promise.all([
    scoped.opportunity.findMany({
      where: { ruleName: OPPORTUNITY_RULE_NAME, ruleVersion: OPPORTUNITY_RULE_VERSION, status: { in: ["new", "reviewed"] } },
      select: { relatedEntityId: true, score: true, confidence: true, evidence: true, updatedAt: true },
    }),
    scoped.risk.findMany({
      where: { ruleName: RISK_RULE_NAME, ruleVersion: RISK_RULE_VERSION, status: "open" },
      select: { relatedEntityId: true, severity: true, evidence: true },
    }),
    scoped.companySignal.findFirst({
      where: { ruleName: REGIME_RULE_NAME, ruleVersion: REGIME_RULE_VERSION, relatedEntityId: "GLOBAL" },
      select: { payload: true, detectedAt: true },
    }),
  ]);

  const validOpportunities = opportunities.filter((o): o is typeof o & { relatedEntityId: string } => o.relatedEntityId !== null);
  const validRisks = risks
    .filter((r): r is typeof r & { relatedEntityId: string } => r.relatedEntityId !== null)
    .map((r) => ({ relatedEntityId: r.relatedEntityId, severity: r.severity, evidence: r.evidence }));

  const regimePayload = regimeSignal?.payload as { regime?: string } | undefined;

  return {
    regime: regimePayload?.regime ?? null,
    regimeObservedAt: regimeSignal?.detectedAt.toISOString() ?? null,
    ranked: rankMarketCandidates(validOpportunities, validRisks, regimePayload?.regime ?? null),
  };
}
