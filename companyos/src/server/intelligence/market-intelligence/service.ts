import { getTenantScopedClient } from "@/server/db/tenant";
import { rankMarketCandidates } from "@/server/intelligence/market-intelligence/ranking";
import { RULE_NAME as OPPORTUNITY_RULE_NAME, RULE_VERSION as OPPORTUNITY_RULE_VERSION } from "@/server/intelligence/opportunity/rules/market-multi-signal";
import { RULE_NAME as RISK_RULE_NAME, RULE_VERSION as RISK_RULE_VERSION } from "@/server/intelligence/risk/rules/market-multi-signal";
import { RULE_NAME as REGIME_RULE_NAME, RULE_VERSION as REGIME_RULE_VERSION } from "@/server/intelligence/signals/rules/market-regime";
import { STRATEGY_CANDIDATE_RULE_NAME, STRATEGY_CANDIDATE_RULE_VERSION } from "@/server/intelligence/strategy/generate";
import { getStrategyTypePerformance } from "@/server/intelligence/strategy-performance/service";
import type { RankedMarketCandidate, StrategyCandidate, StrategyHistoricalPerformance } from "@/server/intelligence/market-intelligence/types";

export type MarketIntelligenceSnapshot = {
  regime: string | null;
  regimeObservedAt: string | null;
  ranked: RankedMarketCandidate[];
  /** Sprint 15: every deterministic strategy candidate this organization currently has, including `NO_TRADE` conclusions for symbols with no qualifying pattern -- sorted score desc, confidence desc, symbol asc (same tie-break style as `ranked`). Empty until `generate-market-strategies` has run at least once. */
  strategies: StrategyCandidate[];
};

/**
 * The single read-only entry point Sprint 14's AI tool and UI page both
 * call. Reads only what `generateMarketIntelligence` (stage 2) and, as of
 * Sprint 15, `generateMarketStrategies` (stage 3) already persisted through
 * the existing `Opportunity`/`Risk` models plus the `CompanySignal` rows
 * stages 1 and 3 write — never recomputes anything, never calls Binance,
 * never calls an LLM.
 */
export async function getMarketIntelligenceRanking(organizationId: string): Promise<MarketIntelligenceSnapshot> {
  const scoped = getTenantScopedClient(organizationId);

  const [opportunities, risks, regimeSignal, strategySignals, strategyTypePerformance] = await Promise.all([
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
    scoped.companySignal.findMany({
      where: { ruleName: STRATEGY_CANDIDATE_RULE_NAME, ruleVersion: STRATEGY_CANDIDATE_RULE_VERSION, status: "active" },
      select: { payload: true },
    }),
    getStrategyTypePerformance(organizationId),
  ]);

  const performanceByStrategyType = new Map<string, StrategyHistoricalPerformance>(
    strategyTypePerformance.map(({ strategyType, performance }) => [
      strategyType,
      {
        shrunkWinRate: performance.shrunkWinRate,
        evaluatedTrades: performance.evaluatedTrades,
        sampleSizeStatus: performance.sampleSizeStatus,
      },
    ]),
  );

  const validOpportunities = opportunities.filter((o): o is typeof o & { relatedEntityId: string } => o.relatedEntityId !== null);
  const validRisks = risks
    .filter((r): r is typeof r & { relatedEntityId: string } => r.relatedEntityId !== null)
    .map((r) => ({ relatedEntityId: r.relatedEntityId, severity: r.severity, evidence: r.evidence }));

  const regimePayload = regimeSignal?.payload as { regime?: string } | undefined;

  const strategies = strategySignals.map((s) => s.payload as unknown as StrategyCandidate);
  const strategiesBySymbol = new Map(strategies.map((s) => [s.symbol, s]));
  const sortedStrategies = [...strategies].sort((a, b) => {
    const scoreDiff = b.score - a.score;
    if (scoreDiff !== 0) return scoreDiff;
    const confidenceDiff = b.confidence - a.confidence;
    if (confidenceDiff !== 0) return confidenceDiff;
    return a.symbol.localeCompare(b.symbol);
  });

  return {
    regime: regimePayload?.regime ?? null,
    regimeObservedAt: regimeSignal?.detectedAt.toISOString() ?? null,
    ranked: rankMarketCandidates(validOpportunities, validRisks, regimePayload?.regime ?? null, strategiesBySymbol, performanceByStrategyType),
    strategies: sortedStrategies,
  };
}
