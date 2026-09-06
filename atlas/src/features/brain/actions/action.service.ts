import "server-only";

import type { Prisma } from "@prisma/client";

import { toActionStatus } from "@/lib/enum-validators";
import { prisma } from "@/lib/prisma";

/**
 * Action Center — prepares actions for user approval.
 * NO automatic execution. Every action requires explicit approval.
 */

interface CreateActionParams {
  organizationId: string;
  type: "EMAIL_DRAFT" | "TASK" | "CALENDAR_PROPOSAL" | "FOLLOW_UP";
  title: string;
  description: string;
  content: Record<string, unknown>;
  sourceInsightId?: string;
  confidence: number;
  reasoning: string;
}

export async function createPreparedAction(params: CreateActionParams) {
  return prisma.preparedAction.create({
    data: {
      organizationId: params.organizationId,
      type: params.type,
      title: params.title,
      description: params.description,
      content: params.content as Prisma.InputJsonValue,
      sourceInsightId: params.sourceInsightId ?? null,
      confidence: params.confidence,
      reasoning: params.reasoning,
    },
  });
}

export async function listPreparedActions(
  organizationId: string,
  status?: string
) {
  return prisma.preparedAction.findMany({
    where: {
      organizationId,
      ...(status && { status: toActionStatus(status) ?? undefined }),
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
}

export async function getPreparedAction(organizationId: string, id: string) {
  return prisma.preparedAction.findFirst({
    where: { id, organizationId },
    select: {
      id: true,
      type: true,
      title: true,
      description: true,
      content: true,
      status: true,
      confidence: true,
      reasoning: true,
    },
  });
}

export async function updateActionStatus(
  organizationId: string,
  id: string,
  status: "APPROVED" | "DISMISSED"
) {
  return prisma.preparedAction.updateMany({
    where: { id, organizationId },
    data: { status },
  });
}

export async function getPendingActionCount(
  organizationId: string
): Promise<number> {
  return prisma.preparedAction.count({
    where: { organizationId, status: "PENDING" },
  });
}

/**
 * Persists what actually happened when an approved action was launched
 * client-side (action-handoff.ts) - mailto/clipboard/Google draft/Google
 * calendar all still work exactly as before; this just gives that
 * existing flow a durable record instead of a fire-and-forget client
 * action with no server-side trace.
 */
export async function recordActionExecution(params: {
  organizationId: string;
  preparedActionId: string;
  channel:
    | "MAILTO"
    | "CLIPBOARD"
    | "GOOGLE_EMAIL_DRAFT"
    | "GOOGLE_CALENDAR_EVENT"
    | "RESEARCH_WORKER";
  status: "COMPLETED" | "FAILED";
  error?: string;
}) {
  const action = await prisma.preparedAction.findFirst({
    where: {
      id: params.preparedActionId,
      organizationId: params.organizationId,
    },
    select: { id: true },
  });
  if (!action) return null;

  return prisma.actionExecution.create({
    data: {
      organizationId: params.organizationId,
      preparedActionId: params.preparedActionId,
      channel: params.channel,
      status: params.status,
      error: params.error ?? null,
      completedAt: new Date(),
    },
  });
}
