import "server-only";

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
      content: params.content,
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
