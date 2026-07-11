import type { Evidence } from "../trust/types";

// =============================================================================
// Decision Canvas — the core deliverable of the Decision Engine
// =============================================================================

/**
 * A structured representation of a business decision.
 * Every business problem is transformed into this format.
 * Every field is explainable.
 */
export interface DecisionCanvas {
  executiveSummary: string;
  problemStatement: string;
  evidence: Evidence[];
  possibleCauses: string[];
  businessImpact: string;
  priorityScore: number;
  scoringBreakdown: ScoringDimension[];
  options: DecisionOption[];
  recommendedDecision: string;
  confidenceScore: number;
  expectedOutcome: string;
  followUpPlan: string[];
}

/** A possible course of action within a decision */
export interface DecisionOption {
  title: string;
  description: string;
  pros: string[];
  cons: string[];
  risk: "low" | "medium" | "high";
  estimatedImpact: string;
}

// =============================================================================
// Decision Scoring — modular, extensible scoring engine
// =============================================================================

/** A single scoring dimension with reasoning */
export interface ScoringDimension {
  name: string;
  score: number;
  weight: number;
  reasoning: string;
}

/** Default scoring weights — configurable per organization in the future */
export const DEFAULT_SCORING_WEIGHTS: Record<string, number> = {
  businessImpact: 0.3,
  urgency: 0.25,
  confidence: 0.2,
  risk: 0.15,
  companyContext: 0.1,
};

// =============================================================================
// Decision Timeline
// =============================================================================

/** A single event in a decision's lifecycle */
export interface TimelineEvent {
  id: string;
  type: string;
  content: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

/** Full timeline for a decision */
export interface DecisionTimeline {
  decisionId: string;
  problemStatement: string;
  status: string;
  events: TimelineEvent[];
  currentPhase: string;
}

// =============================================================================
// Decision Summary (for list views)
// =============================================================================

export interface DecisionSummary {
  id: string;
  problemStatement: string;
  recommendedDecision: string;
  priorityScore: number;
  confidenceScore: number;
  status: string;
  createdAt: string;
}
