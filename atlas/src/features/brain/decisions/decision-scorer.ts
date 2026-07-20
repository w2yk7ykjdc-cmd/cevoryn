import "server-only";

import type { ScoringDimension } from "./types";

/**
 * Decision Scoring Engine
 *
 * Computes a priority score (0-10) from five dimensions:
 * - Business Impact (30%): How much does this affect revenue, growth, team?
 * - Urgency (25%): How time-sensitive is this decision?
 * - Confidence (20%): How much evidence supports the recommendation?
 * - Risk (15%): What happens if this is ignored?
 * - Company Context (10%): How relevant is this to current company goals?
 *
 * Architecture supports future per-org weight customization.
 */

interface ScoringInput {
  businessImpact: { score: number; reasoning: string };
  urgency: { score: number; reasoning: string };
  confidence: { score: number; reasoning: string };
  risk: { score: number; reasoning: string };
  companyContext: { score: number; reasoning: string };
}

const WEIGHTS: Record<string, number> = {
  businessImpact: 0.3,
  urgency: 0.25,
  confidence: 0.2,
  risk: 0.15,
  companyContext: 0.1,
};

/**
 * Compute a weighted priority score from individual dimensions.
 * Returns both the final score and the full breakdown.
 *
 * Pure function — no side effects, fully testable.
 */
export function computeDecisionScore(input: ScoringInput): {
  score: number;
  dimensions: ScoringDimension[];
} {
  const dimensions: ScoringDimension[] = [
    {
      name: "Business Impact",
      score: clamp(input.businessImpact.score),
      weight: WEIGHTS.businessImpact ?? 0.3,
      reasoning: input.businessImpact.reasoning,
    },
    {
      name: "Urgency",
      score: clamp(input.urgency.score),
      weight: WEIGHTS.urgency ?? 0.25,
      reasoning: input.urgency.reasoning,
    },
    {
      name: "Confidence",
      score: clamp(input.confidence.score),
      weight: WEIGHTS.confidence ?? 0.2,
      reasoning: input.confidence.reasoning,
    },
    {
      name: "Risk",
      score: clamp(input.risk.score),
      weight: WEIGHTS.risk ?? 0.15,
      reasoning: input.risk.reasoning,
    },
    {
      name: "Company Context",
      score: clamp(input.companyContext.score),
      weight: WEIGHTS.companyContext ?? 0.1,
      reasoning: input.companyContext.reasoning,
    },
  ];

  const weightedSum = dimensions.reduce(
    (sum, d) => sum + d.score * d.weight,
    0
  );

  return {
    score: Math.round(weightedSum * 10) / 10,
    dimensions,
  };
}

/**
 * Parse AI-generated scoring into structured ScoringInput.
 * Validates and clamps all values to valid ranges.
 */
export function parseScoringResponse(
  raw: Record<string, unknown>
): ScoringInput {
  return {
    businessImpact: extractDimension(raw, "businessImpact"),
    urgency: extractDimension(raw, "urgency"),
    confidence: extractDimension(raw, "confidence"),
    risk: extractDimension(raw, "risk"),
    companyContext: extractDimension(raw, "companyContext"),
  };
}

function extractDimension(
  raw: Record<string, unknown>,
  key: string
): { score: number; reasoning: string } {
  const dim = raw[key];
  if (
    typeof dim === "object" &&
    dim !== null &&
    "score" in dim &&
    "reasoning" in dim
  ) {
    const d = dim as { score: unknown; reasoning: unknown };
    return {
      score: typeof d.score === "number" ? clamp(d.score) : 5,
      reasoning: typeof d.reasoning === "string" ? d.reasoning : "",
    };
  }
  return { score: 5, reasoning: "No data available" };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(10, value));
}
