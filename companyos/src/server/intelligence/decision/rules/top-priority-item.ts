import type { SignalSeverity } from "@prisma/client";

export const RULE_NAME = "top_priority_item";
export const RULE_VERSION = "v1";

/**
 * Shared severity-to-weight mapping so a "high" Risk and a "high" urgency
 * Opportunity carry the identical weight in the ranking below — the same
 * `SignalSeverity` enum both already reuse (see `Risk.severity` and
 * `Opportunity.urgency`), just given a numeric scale here.
 */
export const SEVERITY_WEIGHT: Record<SignalSeverity, number> = { low: 1, medium: 2, high: 3, critical: 4 };

export type RiskCandidate = {
  kind: "risk";
  id: string;
  title: string;
  explanation: string;
  severity: SignalSeverity;
  potentialLoss: number;
  detectedAt: Date;
  /**
   * The underlying `Risk.confidence` DB field, threaded through for Sprint
   * 12's ranking layer (`decision-intelligence/ranking.ts`). Optional so
   * existing callers/tests that construct a candidate without it (this
   * field didn't exist before Sprint 12) keep compiling unchanged --
   * `pickTopPriorityItem`'s own scoring never reads it.
   */
  confidence?: number;
};

export type OpportunityCandidate = {
  kind: "opportunity";
  id: string;
  title: string;
  explanation: string;
  urgency: SignalSeverity;
  potentialImpact: number;
  detectedAt: Date;
  /** See `RiskCandidate.confidence` -- the underlying `Opportunity.confidence` DB field. */
  confidence?: number;
};

export type DecisionCandidate = RiskCandidate | OpportunityCandidate;

export type GeneratedDecision = {
  sourceType: "risk" | "opportunity";
  sourceId: string;
  recommendation: string;
  rationale: string;
  priorityScore: number;
  evidence: Record<string, unknown>;
};

/**
 * Exported for reuse by Sprint 12's `decision-intelligence/ranking.ts`,
 * which layers a historical-performance multiplier on top of this exact
 * same base score rather than inventing a second, competing scoring
 * formula -- see that module's doc comment.
 */
export function priorityScoreFor(candidate: DecisionCandidate): number {
  return candidate.kind === "risk"
    ? SEVERITY_WEIGHT[candidate.severity] * candidate.potentialLoss
    : SEVERITY_WEIGHT[candidate.urgency] * candidate.potentialImpact;
}

/**
 * Deterministic, rule-based ranking — no LLM call, fully unit-testable.
 * V1's only rule: rank every open `Risk` and active `Opportunity` together
 * by severity-weighted dollar exposure (`severityWeight * potentialLoss` or
 * `potentialImpact`), a single comparable scale across both, and surface
 * only the single highest-ranked item — this is advisory synthesis, not a
 * queue, so returning a ranked list would just push the same "what do I do
 * first" decision back onto the human.
 *
 * On a tie, a `Risk` outranks an `Opportunity`: protecting revenue the
 * organization already has takes priority over pursuing revenue it doesn't
 * yet have when the exposure is otherwise comparable. A further tie (same
 * kind, same score) falls back to whichever was detected longest ago — the
 * most stale item, on the reasoning that a decision left unranked the
 * longest has waited long enough.
 */
export function pickTopPriorityItem(candidates: DecisionCandidate[]): GeneratedDecision | null {
  if (candidates.length === 0) return null;

  const ranked = [...candidates].sort((a, b) => {
    const scoreDiff = priorityScoreFor(b) - priorityScoreFor(a);
    if (scoreDiff !== 0) return scoreDiff;
    if (a.kind !== b.kind) return a.kind === "risk" ? -1 : 1;
    return a.detectedAt.getTime() - b.detectedAt.getTime();
  });

  const winner = ranked[0]!;
  const runnerUp = ranked[1];
  const winnerScore = priorityScoreFor(winner);

  const recommendation =
    winner.kind === "risk" ? `Address this risk first: ${winner.title}` : `Pursue this opportunity: ${winner.title}`;

  const rationale = runnerUp
    ? `Ranked highest by severity-weighted dollar exposure ($${winnerScore.toLocaleString()} vs $${priorityScoreFor(runnerUp).toLocaleString()} for the next candidate). ${winner.explanation}`
    : `The only open item currently requiring attention. ${winner.explanation}`;

  return {
    sourceType: winner.kind,
    sourceId: winner.id,
    recommendation,
    rationale,
    priorityScore: winnerScore,
    evidence: {
      candidateCount: candidates.length,
      winnerScore,
      runnerUpScore: runnerUp ? priorityScoreFor(runnerUp) : null,
    },
  };
}
