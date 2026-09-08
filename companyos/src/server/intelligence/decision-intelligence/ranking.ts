import {
  priorityScoreFor,
  type DecisionCandidate,
} from "@/server/intelligence/decision/rules/top-priority-item";
import type {
  CandidateRelatedEntityType,
  RankedDecisionCandidate,
  ShrunkPerformance,
} from "@/server/intelligence/decision-intelligence/types";

/**
 * Both factors below are bounded to [0.5, 1.0] -- deliberately never lower.
 * A candidate with zero recorded confidence or zero historical evidence
 * scales `baseScore` by half, never to zero: this is a ranking NUDGE on top
 * of Sprint 8's real severity-weighted dollar-exposure score, never a veto.
 * Confidence/history can move a candidate up or down the list, but a
 * critical-severity, high-dollar risk can never be ranked as if it doesn't
 * exist just because it's new. See the sprint-12 spec's rule #9: historical
 * performance must never become truth.
 */
export const MIN_FACTOR = 0.5;
export const MAX_FACTOR = 1.0;
export const NEUTRAL_FACTOR = 0.75;

const round2 = (value: number): number => Math.round(value * 100) / 100;

function candidateRelatedEntityType(candidate: DecisionCandidate): CandidateRelatedEntityType {
  return candidate.kind === "risk" ? "Risk" : "Opportunity";
}

/** Exported for reuse (Sprint 17's own `market-intelligence/ranking.ts` historical-performance adjustment reuses this exact bounded [0.5, 1.0] scaling, rather than reimplementing it). */
export function scaleToFactor(percent: number): number {
  const clamped = Math.max(0, Math.min(100, percent));
  return MIN_FACTOR + (clamped / 100) * (MAX_FACTOR - MIN_FACTOR);
}

function confidenceFactorFor(confidence: number | undefined): number {
  return confidence === undefined ? NEUTRAL_FACTOR : scaleToFactor(confidence);
}

function historicalFactorFor(performance: ShrunkPerformance | undefined): number {
  return performance === undefined ? NEUTRAL_FACTOR : scaleToFactor(performance.shrunkSuccessRate);
}

function explanationsFor(
  candidate: DecisionCandidate,
  relatedEntityType: CandidateRelatedEntityType,
  baseScore: number,
  performance: ShrunkPerformance | undefined,
): string[] {
  const reasons: string[] = [];

  reasons.push(
    candidate.kind === "risk"
      ? `Severity-weighted exposure: $${baseScore.toLocaleString()} (${candidate.severity} severity)`
      : `Severity-weighted exposure: $${baseScore.toLocaleString()} (${candidate.urgency} urgency)`,
  );

  if (candidate.confidence !== undefined) {
    reasons.push(`Decision confidence: ${candidate.confidence}%`);
  }

  if (!performance || performance.totalEvaluated === 0) {
    reasons.push(`No historical outcome data yet for ${relatedEntityType} candidates`);
  } else if (performance.sampleSizeStatus === "insufficient_sample") {
    reasons.push(
      `Insufficient historical sample for ${relatedEntityType} outcomes (n=${performance.totalEvaluated}) -- ` +
        `historical performance weighted toward neutral`,
    );
  } else {
    reasons.push(
      `Historical ${relatedEntityType} success rate: ${performance.successRate}% observed, ` +
        `${performance.shrunkSuccessRate}% shrinkage-adjusted (n=${performance.totalEvaluated})`,
    );
  }

  if (performance && performance.totalEvaluated > 0) {
    const reversalRate = Math.round((performance.reversedCount / performance.totalEvaluated) * 100);
    if (reversalRate >= 20) {
      reasons.push(`High historical reversal rate for ${relatedEntityType} outcomes (${reversalRate}%) -- treat with caution`);
    }
  }

  return reasons;
}

/**
 * Deterministic, explainable candidate ranking -- NOT a second decision
 * engine, NOT a replacement for `pickTopPriorityItem`
 * (`generateDecisionForOrganization` is completely untouched by this
 * module and keeps producing the exact same `Decision` row it always has).
 * This ranks the full live candidate SET (every open Risk + active
 * Opportunity) for presentation/advisory purposes, layering a bounded
 * historical-performance multiplier on top of the same severity-weighted
 * base score `pickTopPriorityItem` itself uses (`priorityScoreFor`,
 * imported, not reimplemented).
 *
 * No LLM call. No randomness. Same inputs always produce the same ranked
 * output and the same `rankingReasons`.
 */
export function rankDecisionCandidates(
  candidates: DecisionCandidate[],
  performanceByType: Map<CandidateRelatedEntityType, ShrunkPerformance>,
): RankedDecisionCandidate[] {
  const ranked = candidates.map((candidate): RankedDecisionCandidate => {
    const relatedEntityType = candidateRelatedEntityType(candidate);
    const performance = performanceByType.get(relatedEntityType);

    const baseScore = priorityScoreFor(candidate);
    const confidenceFactor = confidenceFactorFor(candidate.confidence);
    const historicalFactor = historicalFactorFor(performance);
    const priorityScore = baseScore * ((confidenceFactor + historicalFactor) / 2);

    return {
      kind: candidate.kind,
      id: candidate.id,
      title: candidate.title,
      baseScore: round2(baseScore),
      confidenceFactor: round2(confidenceFactor),
      historicalFactor: round2(historicalFactor),
      priorityScore: round2(priorityScore),
      rankingReasons: explanationsFor(candidate, relatedEntityType, baseScore, performance),
    };
  });

  return ranked.sort((a, b) => b.priorityScore - a.priorityScore);
}
