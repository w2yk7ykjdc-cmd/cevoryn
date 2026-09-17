import "server-only";

import { prisma } from "@/lib/prisma";

import { parseDecisionCanvas } from "../decisions/json-schemas";

import { computeAdjustmentFactor } from "./confidence-calibration-math";
import type {
  CalibrationData,
  CalibrationResult,
  OpportunityCalibrationData,
} from "./types";

export { applyCalibration } from "./confidence-calibration-math";

/** Below this many outcome-evaluation rows, no calibration signal exists at
 *  all - returning the neutral adjustmentFactor (1.0) rather than fitting
 *  anything to 1-2 data points. Matches the pre-existing Decision-side
 *  threshold in computeCalibration below (kept as one shared constant so
 *  the two domains can never silently drift apart). */
const MIN_SAMPLE_SIZE = 3;
/** Below this many rows, an adjustmentFactor may exist but is not yet
 *  trustworthy enough to label "isCalibrated" - same pre-existing
 *  Decision-side threshold. */
const CALIBRATED_SAMPLE_SIZE = 5;

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
    // decisionId is nullable because this table now also carries Radar
    // Opportunity outcomes (see prisma/schema.prisma) - confidence
    // calibration is specifically about Decision Canvas confidence scores,
    // so Radar-sourced rows must be excluded here, not just filtered out
    // downstream.
    where: { organizationId, decisionId: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      decisionId: true,
      outcomeScore: true,
    },
  });

  if (evaluations.length < MIN_SAMPLE_SIZE) {
    return {
      adjustmentFactor: 1.0,
      dataPoints: [],
      isCalibrated: false,
    };
  }

  const decisionIds = evaluations
    .map((e: { decisionId: string | null }) => e.decisionId)
    .filter((id): id is string => id !== null);
  const decisions = await prisma.decision.findMany({
    where: { id: { in: decisionIds } },
    select: { id: true, canvas: true },
  });

  const decisionMap = new Map(
    decisions.map((d: { id: string; canvas: unknown }) => [d.id, d])
  );

  const dataPoints: CalibrationData[] = [];

  for (const eval_ of evaluations) {
    if (!eval_.decisionId) continue;
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
    isCalibrated: dataPoints.length >= CALIBRATED_SAMPLE_SIZE,
  };
}

/**
 * Opportunity-domain equivalent of computeCalibration above. Deliberately a
 * separate function, not a parameterized branch of computeCalibration:
 * Decision calibration compares Decision.canvas.confidenceScore (a
 * subjective LLM-estimated confidence in a recommendation) against
 * Decision-sourced OutcomeEvaluation rows; this compares
 * Opportunity.probability against Opportunity-sourced OutcomeEvaluation
 * rows (written by opportunity.service.ts::updateOpportunityStatus on
 * WON/LOST). These are two different real-world quantities that happen to
 * share a [0,1] range - pooling them into one calibration would silently
 * blend unrelated signals, which is exactly what computeCalibration's own
 * `decisionId: { not: null }` filter exists to prevent. The pure
 * adjustment-factor math (computeAdjustmentFactor/applyCalibration) is
 * domain-agnostic and is reused unchanged - only the input metric differs.
 *
 * `probability`, not `confidence`, is the correct "predicted" value here.
 * `Opportunity.confidence` is `event.confidence` (see
 * opportunity-generator.ts: `confidence: event.confidence`) - the LLM's
 * confidence that the underlying signal/event was correctly detected, with
 * no semantic connection to deal outcome. `Opportunity.probability` is the
 * field the generation prompt itself defines as "how likely this actually
 * converts into a real outcome" (see OPPORTUNITY_PROMPT in
 * opportunity-generator.ts) - the one genuinely comparable to a WON=1/
 * LOST=0 outcomeScore. `score` and `economicImpact` were also considered
 * and rejected: `score` is a composite of relevance/strategicFit/
 * economicPotential/timing/confidence, not itself a probability estimate,
 * and `economicImpact` is a dollar range, not a [0,1] value at all.
 */
export async function computeOpportunityCalibration(
  organizationId: string
): Promise<CalibrationResult<OpportunityCalibrationData>> {
  const evaluations = await prisma.outcomeEvaluation.findMany({
    where: { organizationId, opportunityId: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      opportunityId: true,
      outcomeScore: true,
    },
  });

  if (evaluations.length < MIN_SAMPLE_SIZE) {
    return { adjustmentFactor: 1.0, dataPoints: [], isCalibrated: false };
  }

  const opportunityIds = evaluations
    .map((e) => e.opportunityId)
    .filter((id): id is string => id !== null);
  const opportunities = await prisma.opportunity.findMany({
    where: { id: { in: opportunityIds } },
    select: { id: true, probability: true, polarity: true },
  });

  const opportunityMap = new Map(opportunities.map((o) => [o.id, o]));

  const dataPoints: OpportunityCalibrationData[] = [];

  for (const eval_ of evaluations) {
    if (!eval_.opportunityId) continue;
    const opportunity = opportunityMap.get(eval_.opportunityId);
    if (!opportunity) continue;

    const predicted = opportunity.probability;
    const actual = eval_.outcomeScore;

    dataPoints.push({
      predictedConfidence: predicted,
      actualOutcomeScore: actual,
      delta: predicted - actual,
      category: opportunity.polarity,
    });
  }

  if (dataPoints.length === 0) {
    return { adjustmentFactor: 1.0, dataPoints: [], isCalibrated: false };
  }

  const avgDelta =
    dataPoints.reduce((sum, d) => sum + d.delta, 0) / dataPoints.length;

  return {
    adjustmentFactor: computeAdjustmentFactor(avgDelta),
    dataPoints,
    isCalibrated: dataPoints.length >= CALIBRATED_SAMPLE_SIZE,
  };
}
