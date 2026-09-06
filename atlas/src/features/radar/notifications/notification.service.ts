import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export type NotificationType =
  | "NEW_OPPORTUNITY"
  | "HIGH_PRIORITY_EVENT"
  | "THREAT_DETECTED"
  | "ACTION_REQUIRED"
  | "ACTION_COMPLETED"
  | "RESEARCH_COMPLETED"
  | "SYSTEM_ALERT";

interface CreateNotificationParams {
  organizationId: string;
  /** Omit for an org-wide broadcast rather than a single member. */
  userId?: string;
  type: NotificationType;
  title: string;
  body: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

export async function createNotification(params: CreateNotificationParams) {
  return prisma.notification.create({
    data: {
      organizationId: params.organizationId,
      userId: params.userId ?? null,
      type: params.type,
      title: params.title,
      body: params.body,
      entityType: params.entityType ?? null,
      entityId: params.entityId ?? null,
      metadata: (params.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });
}

/**
 * Returns notifications addressed either to this specific user or
 * broadcast to the whole organization (userId null) - both are relevant
 * to any member reading their notification list.
 */
export async function listNotifications(
  organizationId: string,
  userId: string,
  options: { unreadOnly?: boolean; take?: number } = {}
) {
  return prisma.notification.findMany({
    where: {
      organizationId,
      OR: [{ userId }, { userId: null }],
      ...(options.unreadOnly ? { readAt: null } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: options.take ?? 30,
  });
}

export async function countUnreadNotifications(
  organizationId: string,
  userId: string
): Promise<number> {
  return prisma.notification.count({
    where: {
      organizationId,
      OR: [{ userId }, { userId: null }],
      readAt: null,
    },
  });
}

export async function markNotificationRead(organizationId: string, id: string) {
  return prisma.notification.updateMany({
    where: { id, organizationId, readAt: null },
    data: { readAt: new Date() },
  });
}

export async function markAllNotificationsRead(
  organizationId: string,
  userId: string
) {
  return prisma.notification.updateMany({
    where: {
      organizationId,
      OR: [{ userId }, { userId: null }],
      readAt: null,
    },
    data: { readAt: new Date() },
  });
}
