import "server-only";

import { prisma } from "@/lib/prisma";

import type { DecisionCanvas } from "../decisions/types";

import type { RecommendationHistoryEntry, RecommendationMetrics } from "../outcomes/types";

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

  const total = decisions.length;
  if (total === 0) {
    return {
      totalRecommendations: 0,
      acceptanceRate: 0,
      successRate: 0,
      failureRate: 0,
      avgTimeToCompletionHours: 0,
      avgPriorityScore: 0,
      byCategory: {},
    };
  }

  const accepted = decisions.filter(
    (d: { status: string }) =>
      !["PROPOSED", "REJECTED", "IGNORED"].includes(d.status)
  );
  const resolved = decisions.filter(
    (d: { status: string }) =>
      ["SUCCESSFUL", "FAILED", "COMPLETED"].includes(d.status)
  );
  const successful = decisions.filter(
    (d: { status: string }) =>
      d.status === "SUCCESSFUL" || d.status === "COMPLETED"
  );
  const failed = decisions.filter(
    (d: { status: string }) => d.status === "FAILED"
  );

  // Average time to completion
  const completedWithTime = decisions.filter(
    (d: { resolvedAt: Date | null }) => d.resolvedAt !== null
  );
  const avgTimeMs =
    completedWithTime.length > 0
      ? completedWithTime.reduce(
          (sum: number, d: { createdAt: Date; resolvedAt: Date | null }) =>
            sum + ((d.resolvedAt?.getTime() ?? 0) - d.createdAt.getTime()),
          0
        ) / completedWithTime.length
      : 0;

  const avgPriority =
    decisions.reduce(
      (sum: number, d: { priorityScore: number }) => sum + d.priorityScore,
      0
    ) / total;

  // By category (extracted from canvas problem statement first word as proxy)
  const categoryMap = new Map<
    string,
    { count: number; successCount: number }
  >();
  for (const d of decisions) {
    const canvas = d.canvas as DecisionCanvas;
    const cat = canvas.scoringBreakdown?.[0]?.name ?? "General";
    const entry = categoryMap.get(cat) ?? { count: 0, successCount: 0 };
    entry.count++;
    if (
      d.status === "SUCCESSFUL" ||
      d.status === "COMPLETED"
    ) {
      entry.successCount++;
    }
    categoryMap.set(cat, entry);
  }

  const byCategory: Record<string, { count: number; successRate: number }> =
    {};
  for (const [cat, data] of categoryMap) {
    byCategory[cat] = {
      count: data.count,
      successRate: data.count > 0 ? data.successCount / data.count : 0,
    };
  }

  return {
    totalRecommendations: total,
    acceptanceRate: total > 0 ? accepted.length / total : 0,
    successRate: resolved.length > 0 ? successful.length / resolved.length : 0,
    failureRate: resolved.length > 0 ? failed.length / resolved.length : 0,
    avgTimeToCompletionHours: Math.round(avgTimeMs / (1000 * 60 * 60)),
    avgPriorityScore: Math.round(avgPriority * 10) / 10,
    byCategory,
  };
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
    evaluations.map(
      (e: { decisionId: string; outcomeScore: number }) => [
        e.decisionId,
        e.outcomeScore,
      ]
    )
  );

  return decisions.map(
    (d: {
      id: string;
      canvas: unknown;
      status: string;
      priorityScore: number;
      createdAt: Date;
      resolvedAt: Date | null;
    }) => {
      const canvas = d.canvas as DecisionCanvas;
      return {
        decisionId: d.id,
        problemStatement: canvas.problemStatement,
        recommendedDecision: canvas.recommendedDecision,
        status: d.status,
        priorityScore: d.priorityScore,
        confidenceScore: canvas.confidenceScore,
        outcomeScore: evalMap.get(d.id) ?? null,
        createdAt: d.createdAt.toISOString(),
        resolvedAt: d.resolvedAt?.toISOString() ?? null,
      };
    }
  );
}
