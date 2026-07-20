import "server-only";

import { prisma } from "@/lib/prisma";

import { prepareActionsFromInsight } from "../actions/action-preparer";
import { listPreparedActions } from "../actions/action.service";
import { generateInsights, listInsights } from "../insights/insight.service";
import { getMemoriesForContext } from "../memory/memory.service";
import { computePulseScore } from "../pulse/pulse-scorer";
import type { PulseScore } from "../pulse/pulse-scorer";
import { computePulse } from "../pulse/pulse.service";
import { createTrustEnvelope } from "../trust/trust-engine";
import type { Evidence, TrustEnvelope } from "../trust/types";

import type { PulseMetrics } from "./types";

/**
 * Brain Pipeline
 *
 * Observe → Remember → Understand → Detect → Reason → Prioritize → Recommend → Prepare
 *
 * This is the full intelligence cycle. Each stage feeds into the next.
 * The pipeline produces a complete intelligence report wrapped in a TrustEnvelope.
 */

export interface IntelligenceReport {
  pulse: PulseScore;
  priorities: Array<{
    title: string;
    description: string;
    reasoning: string;
    confidence: number;
    priority: number;
  }>;
  insights: Array<{
    id: string;
    title: string;
    summary: string;
    category: string;
    severity: string;
    confidence: number;
  }>;
  recommendedActions: Array<{
    id: string;
    type: string;
    title: string;
    description: string;
    confidence: number;
  }>;
  memoryCount: number;
  dataPoints: number;
}

/**
 * Execute the full brain pipeline for an organization.
 * Returns a TrustEnvelope-wrapped intelligence report.
 */
export async function executePipeline(
  organizationId: string
): Promise<TrustEnvelope<IntelligenceReport>> {
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - 7);

  // ── Stage 1: OBSERVE — collect signals ──
  const [currentPulseMetrics, previousSnapshot, memories, messageCount] =
    await Promise.all([
      computePulse(organizationId, dayStart, now),
      prisma.pulseSnapshot.findFirst({
        where: { organizationId, period: "DAILY" },
        orderBy: { createdAt: "desc" },
        select: { metrics: true },
      }),
      getMemoriesForContext(organizationId, 30),
      prisma.message.count({
        where: {
          conversation: { organizationId },
          createdAt: { gte: weekStart },
        },
      }),
    ]);

  // ── Stage 2: REMEMBER — context from stored memories ──
  // (Already retrieved above)

  // ── Stage 3: UNDERSTAND — compute pulse score ──
  const previousMetrics = previousSnapshot
    ? (previousSnapshot.metrics as unknown as PulseMetrics)
    : null;
  const pulseScore = computePulseScore(currentPulseMetrics, previousMetrics);

  // ── Stage 4: DETECT — find patterns via Insight Engine ──
  await generateInsights(organizationId, weekStart);
  const insights = await listInsights(organizationId, {
    status: "NEW",
    limit: 10,
  });

  // ── Stage 5: REASON — build evidence chain ──
  const evidence: Evidence[] = [];
  if (messageCount > 0) {
    evidence.push({
      source: "pulse",
      sourceId: "pipeline",
      excerpt: `${messageCount} messages analyzed over the past week`,
      timestamp: now.toISOString(),
      weight: 0.6,
    });
  }
  if (memories.length > 0) {
    evidence.push({
      source: "memory",
      sourceId: "pipeline",
      excerpt: `${memories.length} company memories available`,
      timestamp: now.toISOString(),
      weight: 0.5,
    });
  }

  // ── Stage 6: PRIORITIZE — rank insights by priority ──
  const priorities = insights
    .filter((i: { priority: number }) => i.priority >= 7)
    .slice(0, 3)
    .map(
      (i: {
        title: string;
        description: string;
        reasoning: string;
        confidence: number;
        priority: number;
      }) => ({
        title: i.title,
        description: i.description,
        reasoning: i.reasoning,
        confidence: i.confidence,
        priority: i.priority,
      })
    );

  // ── Stage 7: RECOMMEND — surface top insights ──
  const insightSummaries = insights
    .slice(0, 5)
    .map(
      (i: {
        id: string;
        title: string;
        summary: string;
        category: string;
        severity: string;
        confidence: number;
      }) => ({
        id: i.id,
        title: i.title,
        summary: i.summary,
        category: i.category,
        severity: i.severity,
        confidence: i.confidence,
      })
    );

  // ── Stage 8: PREPARE — generate actions from top insights ──
  for (const insight of insights.slice(0, 3)) {
    const typedInsight = insight as {
      id: string;
      title: string;
      description: string;
      recommendedAction: string;
      confidence: number;
    };
    await prepareActionsFromInsight({
      organizationId,
      insightId: typedInsight.id,
      insightTitle: typedInsight.title,
      insightDescription: typedInsight.description,
      insightRecommendedAction: typedInsight.recommendedAction,
      confidence: typedInsight.confidence,
    });
  }

  const pendingActions = await listPreparedActions(organizationId, "PENDING");
  const actionSummaries = pendingActions
    .slice(0, 5)
    .map(
      (a: {
        id: string;
        type: string;
        title: string;
        description: string;
        confidence: number;
      }) => ({
        id: a.id,
        type: a.type,
        title: a.title,
        description: a.description,
        confidence: a.confidence,
      })
    );

  // ── Assemble report ──
  const report: IntelligenceReport = {
    pulse: pulseScore,
    priorities,
    insights: insightSummaries,
    recommendedActions: actionSummaries,
    memoryCount: memories.length,
    dataPoints: messageCount + memories.length + insights.length,
  };

  return createTrustEnvelope({
    data: report,
    evidence,
    reasoning: `Intelligence report based on ${messageCount} messages, ${memories.length} memories, and ${insights.length} detected insights from the past week.`,
    dataWindowHours: 168,
  });
}
