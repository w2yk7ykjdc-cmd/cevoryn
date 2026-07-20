import "server-only";

import { prisma } from "@/lib/prisma";

import { VALID_TRANSITIONS } from "./types";
import { toDecisionStatus, toTimelineEventType } from "@/lib/enum-validators";
import type { DecisionLifecycleState } from "./types";

/**
 * Outcome Service — manages the full lifecycle of recommendations.
 *
 * Every state transition is validated and timestamped.
 * Invalid transitions are rejected to maintain data integrity.
 */

export async function transitionDecision(
  organizationId: string,
  decisionId: string,
  newStatus: DecisionLifecycleState,
  outcome?: string
): Promise<{ success: boolean; error?: string }> {
  const decision = await prisma.decision.findFirst({
    where: { id: decisionId, organizationId },
    select: { status: true },
  });

  if (!decision) {
    return { success: false, error: "Decision not found" };
  }

  const currentStatus = decision.status;
  const allowedNext = VALID_TRANSITIONS[currentStatus];

  if (!allowedNext || !allowedNext.includes(newStatus)) {
    return {
      success: false,
      error: `Cannot transition from ${currentStatus} to ${newStatus}`,
    };
  }

  const isTerminal = ["SUCCESSFUL", "FAILED", "REJECTED"].includes(newStatus);

  const timelineTypeMap: Record<string, string> = {
    ACCEPTED: "USER_ACCEPTED",
    REJECTED: "USER_REJECTED",
    IGNORED: "USER_IGNORED",
    EXECUTED: "EXECUTION_STARTED",
    COMPLETED: "OUTCOME_RECORDED",
    SUCCESSFUL: "OUTCOME_RECORDED",
    FAILED: "OUTCOME_RECORDED",
    UNKNOWN: "OUTCOME_RECORDED",
  };

  await prisma.$transaction(async (tx) => {
    await tx.decision.updateMany({
      where: { id: decisionId, organizationId },
      data: {
        status: toDecisionStatus(newStatus) ?? "PROPOSED",
        ...(isTerminal && { resolvedAt: new Date() }),
        ...(outcome && { outcome }),
      },
    });

    await tx.decisionTimelineEvent.create({
      data: {
        decisionId,
        type: toTimelineEventType(
          timelineTypeMap[newStatus] ?? "OUTCOME_RECORDED"
        ),
        content: outcome ?? `Status changed to ${newStatus}`,
        metadata: {
          previousStatus: currentStatus,
          newStatus,
          timestamp: new Date().toISOString(),
        },
      },
    });
  });

  return { success: true };
}

/**
 * Get the full lifecycle history of a decision with timestamps.
 */
export async function getDecisionLifecycle(
  organizationId: string,
  decisionId: string
) {
  const decision = await prisma.decision.findFirst({
    where: { id: decisionId, organizationId },
    include: {
      timelineEvents: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!decision) return null;

  const transitions = decision.timelineEvents.map(
    (e: {
      type: string;
      content: string;
      metadata: unknown;
      createdAt: Date;
    }) => ({
      type: e.type,
      content: e.content,
      metadata: e.metadata as Record<string, unknown> | null,
      timestamp: e.createdAt.toISOString(),
    })
  );

  return {
    decisionId: decision.id,
    currentStatus: decision.status,
    outcome: decision.outcome,
    resolvedAt: decision.resolvedAt?.toISOString() ?? null,
    transitions,
    durationMs: decision.resolvedAt
      ? decision.resolvedAt.getTime() - decision.createdAt.getTime()
      : null,
  };
}
