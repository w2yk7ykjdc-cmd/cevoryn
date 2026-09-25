/**
 * Deterministic economic value foundation (Step 7A), extended in Step 7B
 * with typed traceability: WHY a value exists (assumptions) and what real
 * data backed it. Pure, DB/AI-free arithmetic, split out the same way
 * opportunity-generation-math.ts and opportunity-scorer.ts already are, so
 * it stays testable without any server-only dependency.
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

/**
 * Where an assumption's value actually came from - a closed set of
 * code-assigned literals, never LLM-authored text. This is the mechanism
 * that keeps an LLM-written guess from ever being presented as if it were
 * real company data: "CompanyProfile.*"/"Opportunity.*" values are always
 * read directly off a real DB row by this file; "LLM_ESTIMATE_UNVALIDATED"
 * is the only source that ever wraps the LLM's own number, and it is
 * labeled as such everywhere it is shown.
 */
export type EconomicAssumptionSource =
  | "CompanyProfile.averageDealSize"
  | "Opportunity.probability"
  | "Opportunity.economicPotential"
  | "LLM_ESTIMATE_UNVALIDATED"
  | "OpportunityCalibration.probability";

export interface EconomicAssumption {
  key: string;
  value: string;
  source: EconomicAssumptionSource;
}

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
  /** Always present - empty when there is no value to explain
   *  (INSUFFICIENT_DATA). Never LLM-authored: every entry's `source` is one
   *  of the fixed literals above, assigned here by code. */
  assumptions: EconomicAssumption[];
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

/**
 * Best-effort human formatting for a real currency code. Falls back to a
 * plain "CUR 1,234" string for a code Intl doesn't recognize as ISO 4217 -
 * `generated.currency` is only validated to be 3 letters, not a real code,
 * so this must never throw.
 */
function formatCurrencyAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString("en-US")}`;
  }
}

function formatCurrencyRange(
  min: number | null,
  max: number | null,
  currency: string
): string {
  if (min === null && max === null) return "unknown";
  if (min !== null && max !== null) {
    return `${formatCurrencyAmount(min, currency)} – ${formatCurrencyAmount(max, currency)}`;
  }
  return formatCurrencyAmount((min ?? max) as number, currency);
}

const INSUFFICIENT_DATA_RESULT: EconomicImpact = {
  basis: "INSUFFICIENT_DATA",
  valueRangeMin: null,
  valueRangeMax: null,
  currency: null,
  assumptions: [],
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
    assumptions: [
      {
        key: "average_deal_size",
        value: formatCurrencyAmount(averageDealSize, currency),
        source: "CompanyProfile.averageDealSize",
      },
      {
        key: "probability",
        value: `${Math.round(probability * 100)}%`,
        source: "Opportunity.probability",
      },
      {
        key: "economic_potential",
        value: `${Math.round(economicPotential * 100)}%`,
        source: "Opportunity.economicPotential",
      },
    ],
    inputs: {
      averageDealSize,
      probability,
      economicPotential,
      lowMultiplier: LOW_MULTIPLIER,
      highMultiplier: HIGH_MULTIPLIER,
    },
  };
}

/**
 * The fallback used when there is no real averageDealSize to compute a
 * DETERMINISTIC result from. Wraps the LLM's own (already-validated,
 * already-produced-independently-of-this-feature) estimatedValueMin/Max
 * range rather than discarding it - but labels it LLM_ESTIMATE_UNVALIDATED
 * everywhere, and its one assumption entry is explicitly sourced as such,
 * never as if it were real company data. Returns INSUFFICIENT_DATA (not a
 * guess) when the LLM didn't produce a range either.
 */
export function buildLlmEstimateEconomicImpact(params: {
  estimatedValueMin: number | null;
  estimatedValueMax: number | null;
  currency: string;
}): EconomicImpact {
  const { estimatedValueMin, estimatedValueMax, currency } = params;
  const hasEstimate = estimatedValueMin !== null || estimatedValueMax !== null;
  if (!hasEstimate) return INSUFFICIENT_DATA_RESULT;

  return {
    basis: "LLM_ESTIMATE_UNVALIDATED",
    valueRangeMin: estimatedValueMin,
    valueRangeMax: estimatedValueMax,
    currency,
    assumptions: [
      {
        key: "llm_estimate_range",
        value: formatCurrencyRange(
          estimatedValueMin,
          estimatedValueMax,
          currency
        ),
        source: "LLM_ESTIMATE_UNVALIDATED",
      },
    ],
  };
}
