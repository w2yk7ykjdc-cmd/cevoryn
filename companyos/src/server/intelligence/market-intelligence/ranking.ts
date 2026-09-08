import type { RankedMarketCandidate } from "@/server/intelligence/market-intelligence/types";

type OpportunityRow = {
  relatedEntityId: string;
  score: number;
  confidence: number;
  evidence: unknown;
  updatedAt: Date;
};

type RiskRow = {
  relatedEntityId: string;
  severity: "low" | "medium" | "high" | "critical";
  evidence: unknown;
};

function buildOpportunityReasons(evidence: unknown): string[] {
  const e = evidence as {
    dailyPercentChange?: number;
    trendConsistency?: number;
    volumeRatio?: number;
    relativeStrength?: number;
    volatilityPct?: number;
    scoreBreakdown?: { volatilityPenalty?: number };
  };
  const reasons: string[] = [];
  if (typeof e.dailyPercentChange === "number") reasons.push(`+ strong momentum (${e.dailyPercentChange}% 24h)`);
  if (typeof e.trendConsistency === "number") reasons.push(`+ consistent medium-term trend (${Math.round(e.trendConsistency * 100)}% consistency)`);
  if (typeof e.volumeRatio === "number") reasons.push(`+ volume confirmation (${e.volumeRatio}x average)`);
  if (typeof e.relativeStrength === "number" && e.relativeStrength > 0) reasons.push(`+ outperforming BTC (+${e.relativeStrength}%)`);
  if (e.scoreBreakdown?.volatilityPenalty && e.scoreBreakdown.volatilityPenalty > 0 && typeof e.volatilityPct === "number") {
    reasons.push(`- elevated volatility (${e.volatilityPct}% avg range)`);
  }
  return reasons;
}

function buildRiskReasons(evidence: unknown): string[] {
  const e = evidence as { conditions?: string[] };
  return (e.conditions ?? []).map((c) => `- ${c.replace(/_/g, " ")}`);
}

/**
 * Deterministic, reproducible ranking (Phase 9) over this organization's
 * currently-active market Opportunities, each annotated with its
 * co-occurring Risk (if any) and the current overall market regime for
 * context — never a second decision engine, purely a presentation-layer
 * sort over already-computed, already-persisted data. Same inputs always
 * produce the same order.
 *
 * Tie-break chain (all deterministic, matching the style
 * `decision/rules/top-priority-item.ts` already established): score
 * descending, then confidence descending, then symbol ascending
 * (alphabetical) as the final, always-decisive fallback.
 */
export function rankMarketCandidates(opportunities: OpportunityRow[], risks: RiskRow[], regime: string | null): RankedMarketCandidate[] {
  const riskBySymbol = new Map(risks.map((r) => [r.relatedEntityId, r]));

  const ranked = opportunities.map((opportunity): RankedMarketCandidate => {
    const risk = riskBySymbol.get(opportunity.relatedEntityId);
    return {
      symbol: opportunity.relatedEntityId,
      opportunityScore: opportunity.score,
      riskSeverity: risk?.severity ?? "none",
      confidence: opportunity.confidence,
      regime,
      reasons: buildOpportunityReasons(opportunity.evidence),
      riskReasons: risk ? buildRiskReasons(risk.evidence) : [],
      updatedAt: opportunity.updatedAt.toISOString(),
    };
  });

  return ranked.sort((a, b) => {
    const scoreDiff = (b.opportunityScore ?? 0) - (a.opportunityScore ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    const confidenceDiff = (b.confidence ?? 0) - (a.confidence ?? 0);
    if (confidenceDiff !== 0) return confidenceDiff;
    return a.symbol.localeCompare(b.symbol);
  });
}
