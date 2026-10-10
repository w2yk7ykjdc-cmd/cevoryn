/**
 * Pure trust-scoring math, split out of trust-engine.ts so it's testable
 * without that file's server-only DB dependency (countGoogleConnections),
 * following the same pattern as confidence-calibration-math.ts.
 */

import type { Evidence } from "./types";

/**
 * Compute a confidence score from weighted evidence.
 *
 * Algorithm:
 * - Sum evidence weights (each 0-1)
 * - Diminishing returns: more evidence helps but doesn't guarantee certainty
 * - Minimum evidence threshold: fewer than 2 pieces → capped at 0.4
 * - Maximum: asymptotically approaches 0.95 (never 1.0)
 */
export function computeConfidence(evidence: Evidence[]): number {
  if (evidence.length === 0) return 0.1;

  const totalWeight = evidence.reduce((sum, e) => sum + e.weight, 0);
  const avgWeight = totalWeight / evidence.length;

  // Sigmoid-like function: more evidence → higher confidence, never reaches 1.0
  const evidenceBonus = 1 - 1 / (1 + evidence.length * 0.3);
  const raw = avgWeight * 0.6 + evidenceBonus * 0.4;

  // Cap at 0.4 if fewer than 2 evidence pieces
  if (evidence.length < 2) return Math.min(raw, 0.4);

  // Cap at 0.95 — CEVORYN never claims absolute certainty
  return Math.min(raw, 0.95);
}
