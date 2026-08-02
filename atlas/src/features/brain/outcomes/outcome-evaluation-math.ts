/**
 * Pure outcome-evaluation helpers, split out of outcome-evaluator.ts so
 * they're testable without that file's server-only AI/DB dependencies.
 */

export function validateResult(
  value: unknown
): "SUCCESS" | "FAILURE" | "PARTIAL_SUCCESS" | "NO_OUTCOME_YET" {
  const valid = new Set(["SUCCESS", "FAILURE", "PARTIAL_SUCCESS"]);
  if (typeof value === "string" && valid.has(value)) {
    return value as "SUCCESS" | "FAILURE" | "PARTIAL_SUCCESS";
  }
  return "NO_OUTCOME_YET";
}

export function clampScore(value: unknown): number {
  if (typeof value !== "number") return 0.5;
  return Math.max(0, Math.min(1, value));
}

/**
 * Confidence in an outcome evaluation, based on how much timeline evidence
 * and how detailed the reported outcome are. Capped at 0.9 — an AI-generated
 * evaluation should never claim near-certainty.
 */
export function computeEvalConfidence(
  evidenceCount: number,
  outcomeLength: number
): number {
  let c = 0.3;
  if (evidenceCount >= 3) c += 0.2;
  else if (evidenceCount >= 1) c += 0.1;
  if (outcomeLength > 50) c += 0.2;
  else if (outcomeLength > 20) c += 0.1;
  c += 0.1; // AI evaluation adds some confidence
  return Math.min(c, 0.9);
}
