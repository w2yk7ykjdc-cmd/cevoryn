import "server-only";

import { toTimelineEventType, toDecisionStatus } from "@/lib/enum-validators";
import { prisma } from "@/lib/prisma";

import type { DecisionCanvas, DecisionTimeline, TimelineEvent } from "./types";

/**
 * Decision Service — manages the lifecycle of decisions.
 *
 * Every decision transitions through:
 * PROPOSED → ACCEPTED / REJECTED / IGNORED → EXECUTED → COMPLETED → SUCCESSFUL / FAILED
 *
 * All transitions are recorded on the timeline for learning.
 */

export async function createDecision(params: {
  organizationId: string;
  canvas: DecisionCanvas;
  priorityScore: number;
}) {
  return prisma.$transaction(async (tx) => {
    const decision = await tx.decision.create({
      data: {
        organizationId: params.organizationId,
        canvas: JSON.parse(JSON.stringify(params.canvas)),
        priorityScore: params.priorityScore,
      },
    });

    // Record initial timeline events
    await tx.decisionTimelineEvent.createMany({
      data: [
        {
          decisionId: decision.id,
          type: "PROBLEM_DETECTED",
          content: params.canvas.problemStatement,
        },
        {
          decisionId: decision.id,
          type: "CANVAS_GENERATED",
          content: `Decision canvas generated with priority score ${params.priorityScore.toFixed(1)}/10`,
        },
        {
          decisionId: decision.id,
          type: "RECOMMENDATION_MADE",
          content: params.canvas.recommendedDecision,
        },
      ],
    });

    return decision;
  });
}

export async function updateDecisionStatus(
  organizationId: string,
  decisionId: string,
  status: "ACCEPTED" | "REJECTED" | "IGNORED" | "COMPLETED",
  outcome?: string
): Promise<boolean> {
  const typeMap: Record<string, string> = {
    ACCEPTED: "USER_ACCEPTED",
    REJECTED: "USER_REJECTED",
    IGNORED: "USER_IGNORED",
    COMPLETED: "OUTCOME_RECORDED",
  };

  return prisma.$transaction(async (tx) => {
    const updated = await tx.decision.updateMany({
      where: { id: decisionId, organizationId },
      data: {
        status,
        ...(status === "COMPLETED" && { resolvedAt: new Date() }),
        ...(outcome && { outcome }),
      },
    });

    if (updated.count === 0) return false;

    await tx.decisionTimelineEvent.create({
      data: {
        decisionId,
        type: toTimelineEventType(typeMap[status] ?? "OUTCOME_RECORDED"),
        content: outcome ?? `Decision ${status.toLowerCase()} by user`,
        metadata: outcome ? { outcome } : undefined,
      },
    });

    return true;
  });
}

export async function listDecisions(
  organizationId: string,
  options: { status?: string; limit?: number } = {}
) {
  return prisma.decision.findMany({
    where: {
      organizationId,
      ...(options.status && {
        status: toDecisionStatus(options.status) ?? undefined,
      }),
    },
    orderBy: [{ priorityScore: "desc" }, { createdAt: "desc" }],
    take: options.limit ?? 20,
  });
}

export async function getDecision(organizationId: string, id: string) {
  return prisma.decision.findFirst({
    where: { id, organizationId },
    include: {
      timelineEvents: { orderBy: { createdAt: "asc" } },
    },
  });
}

export async function getDecisionTimeline(
  organizationId: string,
  decisionId: string
): Promise<DecisionTimeline | null> {
  const decision = await prisma.decision.findFirst({
    where: { id: decisionId, organizationId },
    include: {
      timelineEvents: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!decision) return null;

  const canvas = decision.canvas as unknown as DecisionCanvas;

  const events: TimelineEvent[] = decision.timelineEvents.map(
    (e: {
      id: string;
      type: string;
      content: string;
      metadata: unknown;
      createdAt: Date;
    }) => ({
      id: e.id,
      type: e.type,
      content: e.content,
      metadata: (e.metadata as Record<string, unknown>) ?? null,
      createdAt: e.createdAt.toISOString(),
    })
  );

  const lastEvent = events[events.length - 1];
  const currentPhase = lastEvent ? lastEvent.type : "PROBLEM_DETECTED";

  return {
    decisionId: decision.id,
    problemStatement: canvas.problemStatement,
    status: decision.status,
    events,
    currentPhase,
  };
}

export async function getDecisionStats(organizationId: string) {
  const results = await prisma.decision.groupBy({
    by: ["status"],
    where: { organizationId },
    _count: { id: true },
    _avg: { priorityScore: true },
  });

  return results.reduce(
    (
      acc: Record<string, { count: number; avgPriority: number }>,
      r: {
        status: string;
        _count: { id: number };
        _avg: { priorityScore: number | null };
      }
    ) => {
      acc[r.status] = {
        count: r._count.id,
        avgPriority: Math.round((r._avg.priorityScore ?? 0) * 10) / 10,
      };
      return acc;
    },
    {} as Record<string, { count: number; avgPriority: number }>
  );
}
