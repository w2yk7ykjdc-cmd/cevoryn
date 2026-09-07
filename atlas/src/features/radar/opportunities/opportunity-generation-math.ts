/**
 * Pure validation of the LLM's opportunity-generation output, split out of
 * opportunity-generator.ts so it's testable without server-only AI/DB
 * dependencies - mirrors event-extraction-math.ts's shape.
 */

import { toOpportunityPolarity } from "@/lib/enum-validators";
import type { OpportunityPolarity } from "@/lib/enum-validators";

import type { EvidenceItem } from "../types";

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

/**
 * Parses an ExternalEvent's stored `evidence` Json back into EvidenceItem[]
 * and stamps every item `source: "EXTERNAL"` - these are always built by
 * event-extractor.ts from cited ExternalSignal rows, never from proprietary
 * data. A row written before Step 6 (no `source` field on disk) reads
 * identically to one explicitly tagged EXTERNAL here - this function is
 * itself the "missing source defaults to EXTERNAL" behavior for the write
 * path; readers of already-stored evidence (e.g. the opportunity card)
 * apply that same default independently for existing rows this function
 * never touches.
 */
export function asExternalEvidence(value: unknown): EvidenceItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is Record<string, unknown> =>
        !!item && typeof item === "object" && typeof item.label === "string"
    )
    .map((item) => ({
      label: item.label as string,
      sourceUrl:
        typeof item.sourceUrl === "string" ? item.sourceUrl : undefined,
      excerpt: typeof item.excerpt === "string" ? item.excerpt : undefined,
      source: "EXTERNAL",
    }));
}

/**
 * Builds evidence items for proprietary records actually used as context -
 * application-controlled, never LLM-asserted (the LLM's structured output,
 * validated above, has no evidence field at all). `excerpt` is expected
 * already-truncated by the caller (see excerptProprietaryContent() in
 * proprietary-data.service.ts) - this file stays free of that server-only
 * module so it keeps testing without AI/DB dependencies.
 */
export function buildProprietaryEvidence(
  records: Array<{ title: string; excerpt: string; url: string | null }>
): EvidenceItem[] {
  return records.map((record) => ({
    label: record.title,
    sourceUrl: record.url ?? undefined,
    excerpt: record.excerpt,
    source: "PROPRIETARY",
  }));
}

/**
 * Combines an event's external evidence with the proprietary records that
 * were actually sent to the LLM as context - the only two evidence sources
 * an Opportunity can ever have, and both entirely code-constructed.
 */
export function mergeOpportunityEvidence(
  eventEvidence: unknown,
  proprietaryRecords: Array<{
    title: string;
    excerpt: string;
    url: string | null;
  }>
): EvidenceItem[] {
  return [
    ...asExternalEvidence(eventEvidence),
    ...buildProprietaryEvidence(proprietaryRecords),
  ];
}
