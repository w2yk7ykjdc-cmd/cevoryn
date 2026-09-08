import { scaleToFactor } from "@/server/intelligence/decision-intelligence/ranking";
import type { EvidenceQuality, RankedMarketCandidate, StrategyCandidate, StrategyEvaluationSummary, StrategyHistoricalPerformance } from "@/server/intelligence/market-intelligence/types";

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

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Sprint 17 Phase 7: the bounded historical-performance adjustment.
 * Returns exactly `1.0` (a true no-op) unless this strategy type has
 * reached `MIN_SAMPLE_SIZE` evaluated paper trades -- below that, "we
 * don't have enough evidence yet" is never treated as evidence of good OR
 * bad performance, and ranking is byte-identical to the pre-Sprint-17
 * behavior. Once sufficient, scales via the SAME [0.5, 1.0] bounded curve
 * `decision-intelligence/ranking.ts` already established for CRM
 * candidates (`scaleToFactor`, reused verbatim) — historical performance
 * can nudge a candidate up or down by at most half its current-evidence
 * score, exactly like Sprint 12's own "historical performance must never
 * become truth" rule, never override or replace `opportunityScore` itself.
 */
function historicalFactorFor(performance: StrategyHistoricalPerformance | undefined): number {
  if (!performance || performance.sampleSizeStatus === "insufficient_sample") return 1.0;
  return scaleToFactor(performance.shrunkWinRate);
}

function historicalReasonFor(strategyType: string | undefined, performance: StrategyHistoricalPerformance | undefined): string | null {
  if (!strategyType || !performance) return null;
  if (performance.sampleSizeStatus === "insufficient_sample") {
    return `Insufficient paper-trading history for ${strategyType} (n=${performance.evaluatedTrades}) -- historical performance not yet applied`;
  }
  return `Historical ${strategyType} paper-trading win rate: ${performance.shrunkWinRate}% shrinkage-adjusted (n=${performance.evaluatedTrades})`;
}

/**
 * Sprint 18 Phase 12: a SECOND, independent bounded [0.5, 1.0] adjustment
 * on top of Phase 7's `historicalFactor` -- deliberately not folded into
 * the same factor, because it measures a materially different thing.
 * `historicalFactor` is win-rate only; this one is the strategy's full
 * `StrategyEvaluation.evaluationScore` (consistency, regime/symbol
 * robustness, confidence calibration, drawdown/liquidation penalties).
 * `1.0` (true no-op) whenever evidence is `insufficient` -- an
 * insufficient-evidence strategy can never be marked "proven" by a good
 * score alone (the success criterion's own explicit rule), and this factor
 * cannot itself replace or outrank current market evidence any more than
 * `historicalFactor` can: it can only ever multiply `opportunityScore`
 * DOWN, never above it (`scaleToFactor` is bounded to at most `1.0`).
 */
function evaluationQualityFactorFor(evaluation: StrategyEvaluationSummary | undefined): number {
  if (!evaluation || evaluation.evidenceQuality === "insufficient") return 1.0;
  return scaleToFactor(evaluation.evaluationScore);
}

function evaluationQualityReasonFor(strategyType: string | undefined, evaluation: StrategyEvaluationSummary | undefined): string | null {
  if (!strategyType || !evaluation) return null;
  if (evaluation.evidenceQuality === "insufficient") {
    return `Insufficient evidence to evaluate ${strategyType}'s overall quality yet -- evaluation-quality adjustment not yet applied`;
  }
  return `${strategyType} evaluation quality: ${evaluation.evaluationScore}/100 (evidence: ${evaluation.evidenceQuality})`;
}

const EVIDENCE_QUALITY_RANK: Record<EvidenceQuality, number> = { insufficient: 0, limited: 1, moderate: 2, strong: 3 };

/**
 * Deterministic, reproducible ranking (Phase 9) over this organization's
 * currently-active market Opportunities, each annotated with its
 * co-occurring Risk (if any) and the current overall market regime for
 * context — never a second decision engine, purely a presentation-layer
 * sort over already-computed, already-persisted data. Same inputs always
 * produce the same order.
 *
 * Tie-break chain (Sprint 18 Phase 12 inserted evidence quality as the
 * 2nd key, ahead of confidence -- previously just priority score then
 * confidence then symbol; existing callers that never populate
 * `evaluationByStrategyType` are unaffected, since every candidate then
 * shares the same `"insufficient"` evidence quality and this new key never
 * actually discriminates anything for them): priority score descending,
 * then evidence quality descending (`strong` > `moderate` > `limited` >
 * `insufficient`), then confidence descending, then symbol ascending
 * (alphabetical) as the final, always-decisive fallback. `priorityScore`
 * equals `opportunityScore` (and therefore this ordering is identical to
 * pre-Sprint-17 behavior) whenever `performanceByStrategyType` AND
 * `evaluationByStrategyType` are both omitted, or carry no sufficient
 * sample/evidence for a candidate's own strategy type.
 */
export function rankMarketCandidates(
  opportunities: OpportunityRow[],
  risks: RiskRow[],
  regime: string | null,
  strategiesBySymbol: Map<string, StrategyCandidate> = new Map(),
  performanceByStrategyType: Map<string, StrategyHistoricalPerformance> = new Map(),
  evaluationByStrategyType: Map<string, StrategyEvaluationSummary> = new Map(),
): RankedMarketCandidate[] {
  const riskBySymbol = new Map(risks.map((r) => [r.relatedEntityId, r]));

  const ranked = opportunities.map((opportunity): RankedMarketCandidate => {
    const risk = riskBySymbol.get(opportunity.relatedEntityId);
    const strategy = strategiesBySymbol.get(opportunity.relatedEntityId) ?? null;
    const performance = strategy ? performanceByStrategyType.get(strategy.strategyType) : undefined;
    const evaluation = strategy ? evaluationByStrategyType.get(strategy.strategyType) : undefined;
    const historicalFactor = historicalFactorFor(performance);
    const evaluationQualityFactor = evaluationQualityFactorFor(evaluation);
    const opportunityScore = opportunity.score;
    const priorityScore = Math.max(0, Math.min(100, round2(opportunityScore * historicalFactor * evaluationQualityFactor)));

    const reasons = buildOpportunityReasons(opportunity.evidence);
    const historicalReason = historicalReasonFor(strategy?.strategyType, performance);
    if (historicalReason) reasons.push(historicalReason);
    const evaluationReason = evaluationQualityReasonFor(strategy?.strategyType, evaluation);
    if (evaluationReason) reasons.push(evaluationReason);

    return {
      symbol: opportunity.relatedEntityId,
      opportunityScore,
      riskSeverity: risk?.severity ?? "none",
      confidence: opportunity.confidence,
      regime,
      reasons,
      riskReasons: risk ? buildRiskReasons(risk.evidence) : [],
      updatedAt: opportunity.updatedAt.toISOString(),
      strategy,
      priorityScore,
      historicalFactor: round2(historicalFactor),
      evaluationQualityFactor: round2(evaluationQualityFactor),
      evidenceQuality: evaluation?.evidenceQuality ?? "insufficient",
    };
  });

  return ranked.sort((a, b) => {
    const scoreDiff = b.priorityScore - a.priorityScore;
    if (scoreDiff !== 0) return scoreDiff;
    const evidenceQualityDiff = EVIDENCE_QUALITY_RANK[b.evidenceQuality] - EVIDENCE_QUALITY_RANK[a.evidenceQuality];
    if (evidenceQualityDiff !== 0) return evidenceQualityDiff;
    const confidenceDiff = (b.confidence ?? 0) - (a.confidence ?? 0);
    if (confidenceDiff !== 0) return confidenceDiff;
    return a.symbol.localeCompare(b.symbol);
  });
}
