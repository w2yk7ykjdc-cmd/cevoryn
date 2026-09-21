import "server-only";

import { prisma } from "@/lib/prisma";

import { parseDecisionCanvas } from "../decisions/json-schemas";
import { createMemory } from "../memory/memory.service";

import {
  applyCalibration,
  computeCalibration,
  computeOpportunityCalibration,
} from "./confidence-calibrator";
import type { LearnedPattern, PatternType } from "./types";

/**
 * Learning Engine v1
 *
 * Analyzes completed decisions to extract patterns:
 * - Which recommendations get accepted
 * - Which succeed vs fail
 * - Which problems keep recurring
 *
 * Patterns are stored in LearningPattern and fed back into
 * future decision-making via confidence calibration.
 *
 * Architecture: provider-independent, modular pattern extractors.
 */

/**
 * Extract learning patterns from recent decisions.
 * Call periodically (e.g. daily) or after outcome evaluation.
 */
export async function extractLearningPatterns(
  organizationId: string
): Promise<number> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const decisions = await prisma.decision.findMany({
    where: {
      organizationId,
      createdAt: { gte: since },
      status: {
        in: ["ACCEPTED", "REJECTED", "SUCCESSFUL", "FAILED", "COMPLETED"],
      },
    },
    select: {
      id: true,
      status: true,
      canvas: true,
      priorityScore: true,
      createdAt: true,
      resolvedAt: true,
    },
  });

  if (decisions.length < 3) return 0;

  let patternsCreated = 0;

  patternsCreated += await detectAcceptancePatterns(organizationId, decisions);
  patternsCreated += await detectOutcomePatterns(organizationId, decisions);
  patternsCreated += await detectRepeatPatterns(organizationId, decisions);

  return patternsCreated;
}

async function detectAcceptancePatterns(
  organizationId: string,
  decisions: Array<{
    status: string;
    canvas: unknown;
    priorityScore: number;
  }>
): Promise<number> {
  const accepted = decisions.filter(
    (d) => d.status !== "REJECTED" && d.status !== "IGNORED"
  );
  const rejected = decisions.filter((d) => d.status === "REJECTED");
  const total = accepted.length + rejected.length;

  if (total < 3) return 0;

  const acceptanceRate = accepted.length / total;
  const highPri = decisions.filter((d) => d.priorityScore >= 7);
  const highPriAccepted = highPri.filter(
    (d) => d.status !== "REJECTED" && d.status !== "IGNORED"
  );
  const highPriRate =
    highPri.length > 0 ? highPriAccepted.length / highPri.length : 0;

  let created = 0;

  created += await upsertPattern(organizationId, {
    patternType: "acceptance",
    category: "overall",
    pattern: `Overall acceptance rate: ${Math.round(acceptanceRate * 100)}% (${accepted.length}/${total})`,
    frequency: total,
    confidence: Math.min(total / 10, 0.9),
  });

  if (highPri.length >= 2 && highPriRate > acceptanceRate + 0.1) {
    created += await upsertPattern(organizationId, {
      patternType: "acceptance",
      category: "high_priority",
      pattern: `High-priority recommendations (>=7) accepted at ${Math.round(highPriRate * 100)}%, higher than average`,
      frequency: highPri.length,
      confidence: Math.min(highPri.length / 5, 0.8),
    });
  }

  return created;
}

async function detectOutcomePatterns(
  organizationId: string,
  decisions: Array<{ status: string; canvas: unknown }>
): Promise<number> {
  const withOutcomes = decisions.filter((d) =>
    ["SUCCESSFUL", "FAILED", "COMPLETED"].includes(d.status)
  );

  if (withOutcomes.length < 2) return 0;

  const successful = withOutcomes.filter(
    (d) => d.status === "SUCCESSFUL" || d.status === "COMPLETED"
  );
  const failed = withOutcomes.filter((d) => d.status === "FAILED");
  const successRate = successful.length / withOutcomes.length;

  let created = 0;

  created += await upsertPattern(organizationId, {
    patternType: "success",
    category: "overall",
    pattern: `Recommendation success rate: ${Math.round(successRate * 100)}% (${successful.length}/${withOutcomes.length})`,
    frequency: withOutcomes.length,
    confidence: Math.min(withOutcomes.length / 8, 0.85),
  });

  if (failed.length >= 2) {
    created += await upsertPattern(organizationId, {
      patternType: "failure",
      category: "overall",
      pattern: `${failed.length} recommendations did not achieve expected outcome`,
      frequency: failed.length,
      confidence: Math.min(failed.length / 5, 0.7),
    });

    await createMemory(
      organizationId,
      {
        category: "DECISION",
        content: `Learning: ${failed.length} out of ${withOutcomes.length} recent decisions did not achieve expected outcomes. Success rate: ${Math.round(successRate * 100)}%.`,
      },
      "INSIGHT"
    );
  }

  return created;
}

async function detectRepeatPatterns(
  organizationId: string,
  decisions: Array<{ canvas: unknown }>
): Promise<number> {
  const problemWords = new Map<string, number>();

  for (const d of decisions) {
    const canvas = parseDecisionCanvas(d.canvas);
    if (!canvas) continue;
    const words = canvas.problemStatement
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 4);

    for (const word of words) {
      problemWords.set(word, (problemWords.get(word) ?? 0) + 1);
    }
  }

  let created = 0;
  const recurring = Array.from(problemWords.entries())
    .filter(([_word, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  for (const [word, count] of recurring) {
    created += await upsertPattern(organizationId, {
      patternType: "repeat",
      category: "recurring_theme",
      pattern: `"${word}" appears in ${count} different decision problems — may indicate a systemic issue`,
      frequency: count,
      confidence: Math.min(count / 5, 0.7),
    });
  }

  return created;
}

export async function upsertPattern(
  organizationId: string,
  data: {
    patternType: PatternType;
    category: string;
    pattern: string;
    frequency: number;
    confidence: number;
    /** Structured, explainable detail behind `pattern` (the human-readable
     *  string) - e.g. calibration snapshots store {source, sampleSize,
     *  historicalAccuracy, adjustmentFactor, exampleCalibratedConfidence}
     *  here so the number in `pattern` is traceable, not just asserted. */
    metadata?: Record<string, unknown>;
  }
): Promise<number> {
  const patternWhere = {
    organizationId,
    patternType: data.patternType,
    category: data.category,
  };

  const existing = await prisma.learningPattern.findFirst({
    where: patternWhere as never,
    select: { id: true },
  });

  if (existing) {
    await prisma.learningPattern.update({
      where: { id: existing.id },
      data: {
        pattern: data.pattern,
        frequency: data.frequency,
        confidence: data.confidence,
        ...(data.metadata && { metadata: data.metadata as never }),
      },
    });
    return 0;
  }

  const createData = {
    organizationId,
    patternType: data.patternType,
    category: data.category,
    pattern: data.pattern,
    frequency: data.frequency,
    confidence: data.confidence,
    ...(data.metadata && { metadata: data.metadata as never }),
  };

  await prisma.learningPattern.create({
    data: createData as never,
  });

  return 1;
}

const CALIBRATION_SAMPLE_TAKE = 50;

/**
 * Persists a computeCalibration/computeOpportunityCalibration result as an
 * upserted LearningPattern row (patternType "calibration", category
 * "decision" | "opportunity") - reuses upsertPattern above rather than a
 * new persistence path, so the row participates in the exact same
 * dedup/idempotency behavior extractLearningPatterns's own patterns
 * already rely on (find-by-org+type+category, then update in place).
 *
 * This is also where applyCalibration is actually invoked (see the audit
 * finding that it was defined but never called anywhere): applied to the
 * sample's own average predicted confidence - a real, traceable number
 * from this run's data, not an illustrative placeholder - to produce
 * `exampleCalibratedConfidence`, so a reader can see concretely what the
 * adjustment factor would do to a typical prediction, without this
 * function silently rewriting any stored Opportunity/Decision confidence
 * value.
 */
async function persistCalibrationSnapshot(
  organizationId: string,
  category: "decision" | "opportunity",
  result: {
    adjustmentFactor: number;
    dataPoints: Array<{ predictedConfidence: number }>;
    isCalibrated: boolean;
  }
): Promise<void> {
  const sampleSize = result.dataPoints.length;
  if (sampleSize === 0) return;

  const avgPredicted =
    result.dataPoints.reduce((sum, d) => sum + d.predictedConfidence, 0) /
    sampleSize;
  const exampleCalibratedConfidence = applyCalibration(
    avgPredicted,
    result.adjustmentFactor
  );

  await upsertPattern(organizationId, {
    patternType: "calibration",
    category,
    pattern: result.isCalibrated
      ? `${category === "decision" ? "Decision" : "Opportunity"} confidence calibration: adjustment factor ${result.adjustmentFactor.toFixed(2)} from ${sampleSize} outcomes`
      : `${category === "decision" ? "Decision" : "Opportunity"} calibration not yet reliable: only ${sampleSize} outcome(s) recorded (minimum 5 required)`,
    frequency: sampleSize,
    confidence: result.isCalibrated ? Math.min(sampleSize / 20, 0.9) : 0.2,
    metadata: {
      source: `OutcomeEvaluation(${category === "decision" ? "decisionId" : "opportunityId"} not null), most recent ${CALIBRATION_SAMPLE_TAKE}`,
      sampleSize,
      isCalibrated: result.isCalibrated,
      averagePredictedConfidence: Math.round(avgPredicted * 1000) / 1000,
      adjustmentFactor: result.adjustmentFactor,
      exampleCalibratedConfidence:
        Math.round(exampleCalibratedConfidence * 1000) / 1000,
      computedAt: new Date().toISOString(),
    },
  });
}

/**
 * Full learning cycle for one organization: extract Decision patterns
 * (existing, unchanged), then compute and durably persist both calibration
 * domains (Decision-sourced and Opportunity-sourced OutcomeEvaluation rows,
 * kept strictly separate - see computeOpportunityCalibration's own doc
 * comment for why). Intended to be called on a schedule (see
 * /api/cron/learning-cycle) rather than per-request, so a real calibration
 * history accumulates over time instead of being recomputed from scratch
 * (and immediately discarded) on every API read.
 *
 * Never throws: each of the three steps is independently try/caught so a
 * failure in one (e.g. a single malformed Decision canvas) doesn't prevent
 * the others from running - same isolation discipline as
 * runRadarPipelineForOrganization's per-stage try/catch.
 */
export async function runLearningCycleForOrganization(
  organizationId: string
): Promise<{
  patternsExtracted: number;
  decisionCalibrationSampleSize: number;
  opportunityCalibrationSampleSize: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let patternsExtracted = 0;
  let decisionCalibrationSampleSize = 0;
  let opportunityCalibrationSampleSize = 0;

  try {
    patternsExtracted = await extractLearningPatterns(organizationId);
  } catch (error) {
    errors.push(
      `pattern-extraction: ${error instanceof Error ? error.message : "unknown error"}`
    );
  }

  try {
    const decisionCalibration = await computeCalibration(organizationId);
    decisionCalibrationSampleSize = decisionCalibration.dataPoints.length;
    await persistCalibrationSnapshot(
      organizationId,
      "decision",
      decisionCalibration
    );
  } catch (error) {
    errors.push(
      `decision-calibration: ${error instanceof Error ? error.message : "unknown error"}`
    );
  }

  try {
    const opportunityCalibration =
      await computeOpportunityCalibration(organizationId);
    opportunityCalibrationSampleSize = opportunityCalibration.dataPoints.length;
    await persistCalibrationSnapshot(
      organizationId,
      "opportunity",
      opportunityCalibration
    );
  } catch (error) {
    errors.push(
      `opportunity-calibration: ${error instanceof Error ? error.message : "unknown error"}`
    );
  }

  return {
    patternsExtracted,
    decisionCalibrationSampleSize,
    opportunityCalibrationSampleSize,
    errors,
  };
}

/**
 * Get all learned patterns for an organization.
 */
export async function getLearningPatterns(
  organizationId: string
): Promise<LearnedPattern[]> {
  const patterns = await prisma.learningPattern.findMany({
    where: { organizationId },
    orderBy: [{ confidence: "desc" }, { frequency: "desc" }],
  });

  return patterns.map(
    (p: {
      id: string;
      patternType: string;
      category: string;
      pattern: string;
      frequency: number;
      confidence: number;
      createdAt: Date;
    }) => ({
      id: p.id,
      patternType: p.patternType as PatternType,
      category: p.category,
      pattern: p.pattern,
      frequency: p.frequency,
      confidence: p.confidence,
      createdAt: p.createdAt.toISOString(),
    })
  );
}
