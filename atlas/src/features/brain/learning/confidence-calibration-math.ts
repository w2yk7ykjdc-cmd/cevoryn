/**
 * Pure calibration math, split out of confidence-calibrator.ts so it's
 * testable without that file's server-only DB dependency.
 */

/**
 * Adjustment factor from the average delta between predicted confidence and
 * actual outcome scores. Positive delta = overconfident (reduce future
 * confidence); negative = underconfident (increase, but capped at +5% to
 * prevent confidence inflation).
 */
export function computeAdjustmentFactor(avgDelta: number): number {
  if (avgDelta > 0.05) return Math.max(0.7, 1.0 - avgDelta);
  if (avgDelta < -0.05) return Math.min(1.05, 1.0 - avgDelta * 0.5);
  return 1.0;
}

/**
 * Apply calibration to a raw confidence score. Clamped to [0.05, 0.95] —
 * CEVORYN never claims certainty.
 */
export function applyCalibration(
  rawConfidence: number,
  adjustmentFactor: number
): number {
  const calibrated = rawConfidence * adjustmentFactor;
  return Math.max(0.05, Math.min(0.95, calibrated));
}
