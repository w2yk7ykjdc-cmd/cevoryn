/**
 * Pure validation of the LLM's opportunity-generation output, split out of
 * opportunity-generator.ts so it's testable without server-only AI/DB
 * dependencies - mirrors event-extraction-math.ts's shape.
 */

import { toOpportunityPolarity } from "@/lib/enum-validators";
import type { OpportunityPolarity } from "@/lib/enum-validators";

const MIN_TITLE_LENGTH = 5;

function isUnitInterval(value: unknown): value is number {
  return (
    typeof value === "number" &&
    value >= 0 &&
    value <= 1 &&
    !Number.isNaN(value)
  );
}

export interface GeneratedOpportunity {
  polarity: OpportunityPolarity;
  title: string;
  description: string;
  estimatedValueMin: number | null;
  estimatedValueMax: number | null;
  currency: string;
  probability: number;
  timeHorizon: string;
  reasoning: string;
  recommendedAction: string;
  relevance: number;
  strategicFit: number;
  economicPotential: number;
  timing: number;
}

/**
 * Returns null for: non-object input, a missing/invalid required field, or
 * a value range where min > max (an internally inconsistent estimate is
 * worse than no estimate). The model is explicitly instructed it may
 * return `null` itself when an event isn't actually relevant - that is
 * handled by the caller before this function ever runs, not here.
 */
export function validateGeneratedOpportunity(
  extracted: unknown
): GeneratedOpportunity | null {
  if (!extracted || typeof extracted !== "object") return null;

  const item = extracted as Record<string, unknown>;

  const polarity =
    typeof item.polarity === "string"
      ? toOpportunityPolarity(item.polarity)
      : null;
  if (!polarity) return null;

  if (typeof item.title !== "string" || item.title.length < MIN_TITLE_LENGTH) {
    return null;
  }

  if (
    !isUnitInterval(item.probability) ||
    !isUnitInterval(item.relevance) ||
    !isUnitInterval(item.strategicFit) ||
    !isUnitInterval(item.economicPotential) ||
    !isUnitInterval(item.timing)
  ) {
    return null;
  }

  const estimatedValueMin =
    typeof item.estimatedValueMin === "number" && item.estimatedValueMin >= 0
      ? item.estimatedValueMin
      : null;
  const estimatedValueMax =
    typeof item.estimatedValueMax === "number" && item.estimatedValueMax >= 0
      ? item.estimatedValueMax
      : null;

  if (
    estimatedValueMin !== null &&
    estimatedValueMax !== null &&
    estimatedValueMin > estimatedValueMax
  ) {
    return null;
  }

  return {
    polarity,
    title: item.title,
    description: typeof item.description === "string" ? item.description : "",
    estimatedValueMin,
    estimatedValueMax,
    currency:
      typeof item.currency === "string" && item.currency.length === 3
        ? item.currency.toUpperCase()
        : "EUR",
    probability: item.probability,
    timeHorizon:
      typeof item.timeHorizon === "string" ? item.timeHorizon : "unknown",
    reasoning: typeof item.reasoning === "string" ? item.reasoning : "",
    recommendedAction:
      typeof item.recommendedAction === "string" ? item.recommendedAction : "",
    relevance: item.relevance,
    strategicFit: item.strategicFit,
    economicPotential: item.economicPotential,
    timing: item.timing,
  };
}
