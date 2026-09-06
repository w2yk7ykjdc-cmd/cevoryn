import "server-only";

import { prisma } from "@/lib/prisma";

import { parseDecisionCanvas } from "../decisions/json-schemas";
import type {
  RecommendationHistoryEntry,
  RecommendationMetrics,
} from "../outcomes/types";

import { computeMetricsFromDecisions } from "./recommendation-metrics-math";

/**
 * Compute recommendation performance metrics.
 * All metrics derived from real decision data — no estimates.
 */
export async function computeRecommendationMetrics(
  organizationId: string
): Promise<RecommendationMetrics> {
  const decisions = await prisma.decision.findMany({
    where: { organizationId },
    select: {
      status: true,
      canvas: true,
      priorityScore: true,
      createdAt: true,
      resolvedAt: true,
    },
  });

  return computeMetricsFromDecisions(decisions);
}

/**
 * Get recommendation history for an organization.
 */
export async function getRecommendationHistory(
  organizationId: string,
  limit: number = 30
): Promise<RecommendationHistoryEntry[]> {
  const decisions = await prisma.decision.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      canvas: true,
      status: true,
      priorityScore: true,
      createdAt: true,
      resolvedAt: true,
    },
  });

  // Get outcome scores
  const decisionIds = decisions.map((d: { id: string }) => d.id);
  const evaluations = await prisma.outcomeEvaluation.findMany({
    where: { decisionId: { in: decisionIds } },
    select: { decisionId: true, outcomeScore: true },
  });

  const evalMap = new Map(
    evaluations
      .filter(
        (e: { decisionId: string | null; outcomeScore: number }) =>
          e.decisionId !== null
      )
      .map((e: { decisionId: string | null; outcomeScore: number }) => [
        e.decisionId as string,
        e.outcomeScore,
      ])
  );

  return decisions.flatMap(
    (d: {
      id: string;
      canvas: unknown;
      status: string;
      priorityScore: number;
      createdAt: Date;
      resolvedAt: Date | null;
    }) => {
      const canvas = parseDecisionCanvas(d.canvas);
      if (!canvas) return [];
      return [
        {
          decisionId: d.id,
          problemStatement: canvas.problemStatement,
          recommendedDecision: canvas.recommendedDecision,
          status: d.status,
          priorityScore: d.priorityScore,
          confidenceScore: canvas.confidenceScore,
          outcomeScore: evalMap.get(d.id) ?? null,
          createdAt: d.createdAt.toISOString(),
          resolvedAt: d.resolvedAt?.toISOString() ?? null,
        },
      ];
    }
  );
}
