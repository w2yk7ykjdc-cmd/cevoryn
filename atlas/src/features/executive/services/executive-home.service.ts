import "server-only";

import { prisma } from "@/lib/prisma";
import type { MembershipContext } from "@/types";
import { computePulse } from "@/features/brain/pulse/pulse.service";
import { computePulseScore } from "@/features/brain/pulse/pulse-scorer";
import type { PulseMetrics } from "@/features/brain/core/types";
import type { DecisionCanvas } from "@/features/brain/decisions/types";
import type { Evidence } from "@/features/brain/trust/types";

import type {
  ActionItem,
  AttentionItem,
  ExecutiveHomeData,
  ExecutiveState,
  PulseStatus,
  TopPriorityItem,
} from "../types";

const MIN_DATA_THRESHOLD = 3;

/**
 * Load all data for the Executive Home in a single server call.
 * No waterfalls, no duplicate fetches.
 */
export async function loadExecutiveHome(
  membership: MembershipContext
): Promise<ExecutiveHomeData> {
  const orgId = membership.organizationId;
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - 7);

  // Parallel fetch — all data at once
  const [
    pulseMetrics,
    previousSnapshot,
    topInsights,
    pendingDecisions,
    pendingActions,
    memoryCount,
    messageCount,
    resolvedCount,
  ] = await Promise.all([
    computePulse(orgId, dayStart, now),
    prisma.pulseSnapshot.findFirst({
      where: { organizationId: orgId, period: "DAILY" },
      orderBy: { createdAt: "desc" },
      select: { metrics: true },
    }),
    prisma.insight.findMany({
      where: { organizationId: orgId, status: "NEW" },
      orderBy: [{ priority: "desc" }, { severity: "desc" }],
      take: 4,
    }),
    prisma.decision.findMany({
      where: { organizationId: orgId, status: "PROPOSED" },
      orderBy: { priorityScore: "desc" },
      take: 3,
    }),
    prisma.preparedAction.findMany({
      where: { organizationId: orgId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.memory.count({ where: { organizationId: orgId, isActive: true } }),
    prisma.message.count({
      where: {
        conversation: { organizationId: orgId },
        createdAt: { gte: weekStart },
      },
    }),
    prisma.decision.count({
      where: {
        organizationId: orgId,
        status: { in: ["SUCCESSFUL", "COMPLETED"] },
        resolvedAt: { gte: weekStart },
      },
    }),
  ]);

  // Determine state
  const state = determineState(messageCount, memoryCount, topInsights.length);
  const insufficientDataReasons = state === "insufficient_data"
    ? buildInsufficientReasons(messageCount, memoryCount)
    : [];

  // Pulse
  const previousMetrics = previousSnapshot
    ? previousSnapshot.metrics as unknown as PulseMetrics
    : null;
  const pulseScore = computePulseScore(pulseMetrics, previousMetrics);

  const pulse: PulseStatus | null =
    state !== "insufficient_data"
      ? {
          score: pulseScore.score,
          trend: pulseScore.trend,
          statement: buildPulseStatement(pulseScore.score, pulseScore.trend, topInsights.length),
        }
      : null;

  // Top priority — highest-priority insight or decision
  const topPriority = buildTopPriority(topInsights, pendingDecisions);

  // Attention queue — max 3, excluding top priority
  const attentionItems = buildAttentionQueue(topInsights, pendingDecisions, topPriority?.id);

  // Actions
  const actions: ActionItem[] = pendingActions.map(
    (a: {
      id: string;
      type: string;
      title: string;
      description: string;
      confidence: number;
      reasoning: string;
      sourceInsightId: string | null;
      status: string;
    }) => ({
      id: a.id,
      type: a.type,
      title: a.title,
      description: a.description,
      confidence: a.confidence,
      reasoning: a.reasoning,
      sourceInsightId: a.sourceInsightId,
      status: a.status,
    })
  );

  // Greeting
  const hour = now.getHours();
  const timeOfDay = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const greeting = `${timeOfDay}, ${membership.displayName}`;

  const dateLabel = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const quietMessage =
    state === "quiet"
      ? "Nothing urgent requires your attention today. Focus on growth."
      : "";

  return {
    greeting,
    dateLabel,
    state,
    pulse,
    topPriority,
    attentionItems,
    pendingActions: actions,
    quietMessage,
    insufficientDataReasons,
    resolvedRecently: resolvedCount,
    memoryCount,
  };
}

function determineState(
  messageCount: number,
  memoryCount: number,
  insightCount: number
): ExecutiveState {
  if (messageCount < MIN_DATA_THRESHOLD && memoryCount < MIN_DATA_THRESHOLD) {
    return "insufficient_data";
  }
  if (insightCount === 0) {
    return "quiet";
  }
  return "active";
}

function buildInsufficientReasons(
  messageCount: number,
  memoryCount: number
): string[] {
  const reasons: string[] = [];
  if (messageCount < MIN_DATA_THRESHOLD) {
    reasons.push(
      `Only ${messageCount} conversation message${messageCount === 1 ? "" : "s"} this week. Atlas needs more conversations to identify patterns.`
    );
  }
  if (memoryCount < MIN_DATA_THRESHOLD) {
    reasons.push(
      "Limited company knowledge stored. Use chat to share context about your business."
    );
  }
  reasons.push("Calendar integration not connected");
  reasons.push("Task management system not connected");
  return reasons;
}

function buildPulseStatement(
  score: number,
  trend: string,
  insightCount: number
): string {
  if (insightCount === 0) return "Everything is under control.";
  if (insightCount === 1) return "One issue needs your attention today.";

  const urgency = score < 40
    ? `${insightCount} issues need your attention.`
    : `${insightCount} items to review.`;

  const trendNote =
    trend === "improving"
      ? " Things are trending upward."
      : trend === "declining"
        ? " Activity is trending down."
        : "";

  return urgency + trendNote;
}

function buildTopPriority(
  insights: Array<{
    id: string;
    title: string;
    category: string;
    severity: string;
    summary: string;
    description: string;
    impact: string;
    confidence: number;
    reasoning: string;
    recommendedAction: string;
    evidence: unknown;
  }>,
  decisions: Array<{ id: string; canvas: unknown; priorityScore: number }>
): TopPriorityItem | null {
  // Check highest-priority decision first
  const topDecision = decisions[0];
  const topInsight = insights[0];

  if (
  topDecision &&
  (!topInsight ||
    topDecision.priorityScore >= (topInsight.confidence ?? 0))
) {
    const canvas = topDecision.canvas as unknown as DecisionCanvas;
    return {
      id: topDecision.id,
      title: canvas.problemStatement,
      category: canvas.scoringBreakdown?.[0]?.name ?? "General",
      severity: canvas.priorityScore >= 8 ? "CRITICAL" : canvas.priorityScore >= 6 ? "WARNING" : "SUGGESTION",
      summary: canvas.executiveSummary,
      description: canvas.businessImpact,
      impact: canvas.businessImpact,
      confidence: canvas.confidenceScore,
      reasoning: canvas.scoringBreakdown?.map((d: { name: string; reasoning: string }) => `${d.name}: ${d.reasoning}`).join(". ") ?? "",
      recommendedAction: canvas.recommendedDecision,
      evidence: canvas.evidence ?? [],
      missingInformation: canvas.followUpPlan ?? [],
    };
  }

  if (!topInsight) return null;

  return {
    id: topInsight.id,
    title: topInsight.title,
    category: topInsight.category,
    severity: topInsight.severity,
    summary: topInsight.summary,
    description: topInsight.description,
    impact: topInsight.impact,
    confidence: topInsight.confidence,
    reasoning: topInsight.reasoning,
    recommendedAction: topInsight.recommendedAction,
    evidence: (topInsight.evidence as Evidence[]) ?? [],
    missingInformation: [],
  };
}

function buildAttentionQueue(
  insights: Array<{
    id: string;
    title: string;
    summary: string;
    category: string;
    severity: string;
    confidence: number;
    recommendedAction: string;
    priority: number;
  }>,
  decisions: Array<{ id: string; canvas: unknown; priorityScore: number }>,
  excludeId?: string
): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const i of insights) {
    if (i.id === excludeId) continue;
    items.push({
      id: i.id,
      type: "insight",
      title: i.title,
      summary: i.summary,
      priority: i.priority,
      confidence: i.confidence,
      severity: i.severity,
      recommendedAction: i.recommendedAction,
    });
  }

  for (const d of decisions) {
    if (d.id === excludeId) continue;
    const canvas = d.canvas as DecisionCanvas;
    items.push({
      id: d.id,
      type: "decision",
      title: canvas.problemStatement,
      summary: canvas.executiveSummary,
      priority: d.priorityScore,
      confidence: canvas.confidenceScore,
      severity: d.priorityScore >= 8 ? "CRITICAL" : "SUGGESTION",
      recommendedAction: canvas.recommendedDecision,
    });
  }

  // Sort by priority descending, take max 3
  return items.sort((a, b) => b.priority - a.priority).slice(0, 3);
}
