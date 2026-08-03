/**
 * Pure recommendation-metrics computation, split out of analytics.ts so it's
 * testable without that file's server-only Prisma dependency.
 */

import type { DecisionCanvas } from "../decisions/types";
import type { RecommendationMetrics } from "../outcomes/types";

export interface DecisionMetricsInput {
  status: string;
  canvas: unknown;
  priorityScore: number;
  createdAt: Date;
  resolvedAt: Date | null;
}

export function computeMetricsFromDecisions(
  decisions: DecisionMetricsInput[]
): RecommendationMetrics {
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
    (d) => !["PROPOSED", "REJECTED", "IGNORED"].includes(d.status)
  );
  const resolved = decisions.filter((d) =>
    ["SUCCESSFUL", "FAILED", "COMPLETED"].includes(d.status)
  );
  const successful = decisions.filter(
    (d) => d.status === "SUCCESSFUL" || d.status === "COMPLETED"
  );
  const failed = decisions.filter((d) => d.status === "FAILED");

  const completedWithTime = decisions.filter((d) => d.resolvedAt !== null);
  const avgTimeMs =
    completedWithTime.length > 0
      ? completedWithTime.reduce(
          (sum, d) => sum + ((d.resolvedAt?.getTime() ?? 0) - d.createdAt.getTime()),
          0
        ) / completedWithTime.length
      : 0;

  const avgPriority =
    decisions.reduce((sum, d) => sum + d.priorityScore, 0) / total;

  // By category (extracted from canvas problem statement first word as proxy)
  const categoryMap = new Map<
    string,
    { count: number; successCount: number }
  >();
  for (const d of decisions) {
    const canvas = d.canvas as unknown as DecisionCanvas;
    const cat = canvas.scoringBreakdown?.[0]?.name ?? "General";
    const entry = categoryMap.get(cat) ?? { count: 0, successCount: 0 };
    entry.count++;
    if (d.status === "SUCCESSFUL" || d.status === "COMPLETED") {
      entry.successCount++;
    }
    categoryMap.set(cat, entry);
  }

  const byCategory: Record<string, { count: number; successRate: number }> = {};
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
