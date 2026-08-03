/**
 * Pure insight validation and confidence scoring, split out of
 * insight.service.ts so it's testable without that file's server-only
 * AI/DB dependencies.
 */

export interface RawInsight {
  category: string;
  severity: string;
  title: string;
  summary: string;
  description: string;
  impact: string;
  reasoning: string;
  recommendedAction: string;
  priority: number;
}

const VALID_CATEGORIES = new Set([
  "STRATEGIC",
  "OPERATIONAL",
  "TEAM",
  "FINANCIAL",
  "RISK",
]);

const VALID_SEVERITIES = new Set(["INFO", "SUGGESTION", "WARNING", "CRITICAL"]);

/**
 * Whether a raw AI-proposed insight has the minimum required fields and a
 * recognized category/severity to be worth persisting.
 */
export function isValidRawInsight(insight: RawInsight): boolean {
  if (!insight.title || !insight.description) return false;
  if (!VALID_CATEGORIES.has(insight.category)) return false;
  if (!VALID_SEVERITIES.has(insight.severity)) return false;
  return true;
}

/**
 * Confidence in a generated insight, based on the depth of its reasoning
 * and impact statements, how much conversation evidence backs it, and
 * whether the model flagged it as high priority. Capped at 0.95 — an
 * AI-generated insight should never claim certainty.
 */
export function computeInsightConfidence(
  insight: RawInsight,
  evidenceCount: number
): number {
  let score = 0.3;
  if (insight.reasoning && insight.reasoning.length > 20) score += 0.2;
  if (insight.impact && insight.impact.length > 10) score += 0.1;
  if (evidenceCount >= 3) score += 0.2;
  else if (evidenceCount >= 1) score += 0.1;
  if (insight.priority >= 8) score += 0.1;
  return Math.min(score, 0.95);
}

/** Clamps a raw AI-proposed priority into the valid [1, 10] range. */
export function clampInsightPriority(priority: number): number {
  return Math.max(1, Math.min(10, priority || 5));
}
