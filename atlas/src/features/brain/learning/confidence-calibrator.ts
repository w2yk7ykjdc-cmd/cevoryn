import "server-only";

import { prisma } from "@/lib/prisma";

import { parseDecisionCanvas } from "../decisions/json-schemas";

import { computeAdjustmentFactor } from "./confidence-calibration-math";
import type { CalibrationData } from "./types";

export { applyCalibration } from "./confidence-calibration-math";

/**
 * Confidence Calibration Engine
 *
 * Compares predicted confidence with actual outcome scores
 * to compute a calibration adjustment factor.
 *
 * If CEVORYN is consistently overconfident, future confidence is reduced.
 * If CEVORYN is underconfident, future confidence is slightly increased.
 *
 * Confidence must never be inflated.
 */

/**
 * Compute calibration data from historical decisions.
 * Returns the average delta between predicted confidence and actual outcome.
 *
 * Pure function output — no side effects.
 */
export async function computeCalibration(organizationId: string): Promise<{
  adjustmentFactor: number;
  dataPoints: CalibrationData[];
  isCalibrated: boolean;
}> {
  const evaluations = await prisma.outcomeEvaluation.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      decisionId: true,
      outcomeScore: true,
    },
  });

  if (evaluations.length < 3) {
    return {
      adjustmentFactor: 1.0,
      dataPoints: [],
      isCalibrated: false,
    };
  }

  const decisionIds = evaluations.map(
    (e: { decisionId: string }) => e.decisionId
  );
  const decisions = await prisma.decision.findMany({
    where: { id: { in: decisionIds } },
    select: { id: true, canvas: true },
  });

  const decisionMap = new Map(
    decisions.map((d: { id: string; canvas: unknown }) => [d.id, d])
  );

  const dataPoints: CalibrationData[] = [];

  for (const eval_ of evaluations) {
    const decision = decisionMap.get(eval_.decisionId);
    if (!decision) continue;

    const canvas = parseDecisionCanvas(decision.canvas);
    if (!canvas) continue;
    const predicted = canvas.confidenceScore ?? 0.5;
    const actual = eval_.outcomeScore;

    dataPoints.push({
      predictedConfidence: predicted,
      actualOutcomeScore: actual,
      delta: predicted - actual,
      category: canvas.problemStatement.split(" ").slice(0, 2).join(" "),
    });
  }

  if (dataPoints.length === 0) {
    return { adjustmentFactor: 1.0, dataPoints: [], isCalibrated: false };
  }

  // Average delta: positive = overconfident, negative = underconfident
  const avgDelta =
    dataPoints.reduce((sum, d) => sum + d.delta, 0) / dataPoints.length;

  return {
    adjustmentFactor: computeAdjustmentFactor(avgDelta),
    dataPoints,
    isCalibrated: dataPoints.length >= 5,
  };
}
