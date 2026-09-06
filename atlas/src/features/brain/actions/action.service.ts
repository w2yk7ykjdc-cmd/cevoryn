import "server-only";

import type { Prisma } from "@prisma/client";

import { recordAuditEvent } from "@/features/enterprise/audit/audit.service";
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

/**
 * Idempotency guard (Phase 2 hardening): only a PENDING action can
 * transition to APPROVED/DISMISSED. Previously this updated unconditionally,
 * so a duplicated PATCH (double-click, retried request, two tabs) on an
 * already-APPROVED action would silently re-succeed and the client would
 * re-run launchApprovedAction() a second time - re-opening a mailto/
 * calendar window or re-copying to the clipboard. Restricting the WHERE
 * clause to status: "PENDING" makes the second call affect zero rows, so
 * callers correctly see "not found" instead of a false success.
 */
export async function updateActionStatus(
  organizationId: string,
  id: string,
  status: "APPROVED" | "DISMISSED",
  actorUserId: string
) {
  const result = await prisma.preparedAction.updateMany({
    where: { id, organizationId, status: "PENDING" },
    data: { status },
  });

  if (result.count > 0) {
    await recordAuditEvent({
      organizationId,
      actorType: "USER",
      actorId: actorUserId,
      action: status === "APPROVED" ? "action.approved" : "action.dismissed",
      resourceType: "prepared_action",
      resourceId: id,
    });
  }

  return result;
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
  actorUserId: string;
}) {
  const action = await prisma.preparedAction.findFirst({
    where: {
      id: params.preparedActionId,
      organizationId: params.organizationId,
    },
    select: { id: true, status: true },
  });
  // Executing an action the user never approved (still PENDING) or
  // explicitly rejected (DISMISSED) would let a client record a fake
  // "completed" audit trail for something that was never actually
  // authorized - the lifecycle is PENDING -> APPROVED -> executed, and
  // this must reject any attempt to skip the approval step.
  if (!action || action.status !== "APPROVED") return null;

  // Idempotency guard: a completed execution already recorded for this
  // action means the side effect (mailto/clipboard/etc.) already happened
  // once - a duplicated record-execution call (retry, double-submit) must
  // not be reported as a second successful execution.
  const existingCompleted = await prisma.actionExecution.findFirst({
    where: {
      preparedActionId: params.preparedActionId,
      organizationId: params.organizationId,
      status: "COMPLETED",
    },
  });
  if (existingCompleted) return existingCompleted;

  const execution = await prisma.actionExecution.create({
    data: {
      organizationId: params.organizationId,
      preparedActionId: params.preparedActionId,
      channel: params.channel,
      status: params.status,
      error: params.error ?? null,
      completedAt: new Date(),
    },
  });

  await recordAuditEvent({
    organizationId: params.organizationId,
    actorType: "USER",
    actorId: params.actorUserId,
    action: "action.executed",
    resourceType: "prepared_action",
    resourceId: params.preparedActionId,
    metadata: { channel: params.channel, status: params.status },
  });

  return execution;
}
