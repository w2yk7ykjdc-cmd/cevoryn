/**
 * Deterministic economic value foundation (Step 7A). Pure, DB/AI-free
 * arithmetic, split out the same way opportunity-generation-math.ts and
 * opportunity-scorer.ts already are, so it stays testable without any
 * server-only dependency.
 *
 * This is the ONLY place a dollar figure is allowed to be code-computed
 * rather than LLM-guessed. It runs only when CompanyProfile.averageDealSize
 * is a real, usable number - the only structured economic-scale anchor
 * that exists anywhere in the schema today (see Step 7 analysis). When
 * that number is missing or invalid, this returns INSUFFICIENT_DATA and
 * nothing - never a guessed or defaulted figure.
 */

export type EconomicImpactBasis =
  "DETERMINISTIC" | "LLM_ESTIMATE_UNVALIDATED" | "INSUFFICIENT_DATA";

export interface EconomicImpactInputs {
  averageDealSize: number | null;
  probability: number;
  economicPotential: number;
  currency: string;
}

export interface EconomicImpact {
  basis: EconomicImpactBasis;
  valueRangeMin: number | null;
  valueRangeMax: number | null;
  currency: string | null;
  /** Only present when basis is DETERMINISTIC - the exact inputs and fixed
   *  multiplier band that produced the range, so the number is reviewable
   *  rather than a black box. */
  inputs?: {
    averageDealSize: number;
    probability: number;
    economicPotential: number;
    lowMultiplier: number;
    highMultiplier: number;
  };
}

/**
 * Fixed, explainable band around the base estimate - not tuned per
 * opportunity, not LLM-suggested. Mirrors the existing "always a range,
 * never a fake-precise number" discipline already enforced on the LLM's
 * own estimatedValueMin/Max, now enforced by code instead.
 */
const LOW_MULTIPLIER = 0.6;
const HIGH_MULTIPLIER = 1.4;

function isUnitInterval(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function isUsableDealSize(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

const INSUFFICIENT_DATA_RESULT: EconomicImpact = {
  basis: "INSUFFICIENT_DATA",
  valueRangeMin: null,
  valueRangeMax: null,
  currency: null,
};

export function calculateDeterministicEconomicImpact(
  inputs: EconomicImpactInputs
): EconomicImpact {
  const { averageDealSize, probability, economicPotential, currency } = inputs;

  if (!isUsableDealSize(averageDealSize)) return INSUFFICIENT_DATA_RESULT;
  if (!isUnitInterval(probability) || !isUnitInterval(economicPotential)) {
    return INSUFFICIENT_DATA_RESULT;
  }

  const baseEstimate = averageDealSize * probability * economicPotential;

  return {
    basis: "DETERMINISTIC",
    valueRangeMin: Math.round(baseEstimate * LOW_MULTIPLIER),
    valueRangeMax: Math.round(baseEstimate * HIGH_MULTIPLIER),
    currency,
    inputs: {
      averageDealSize,
      probability,
      economicPotential,
      lowMultiplier: LOW_MULTIPLIER,
      highMultiplier: HIGH_MULTIPLIER,
    },
  };
}
