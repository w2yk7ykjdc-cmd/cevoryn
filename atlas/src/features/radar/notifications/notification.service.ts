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

/** Duplicate-notification suppression window - see createNotification. */
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Creates a notification, unless an identical one (same org, user, type,
 * and entity) was already created within the dedup window - the pipeline
 * re-running on a cron schedule must never spam a member with repeated
 * "new opportunity" notifications for the same opportunity. Returns the
 * existing notification (not a new row) when a duplicate is suppressed,
 * so a caller can still tell something was already surfaced.
 */
export async function createNotification(params: CreateNotificationParams) {
  if (params.entityType && params.entityId) {
    const existing = await prisma.notification.findFirst({
      where: {
        organizationId: params.organizationId,
        userId: params.userId ?? null,
        type: params.type,
        entityType: params.entityType,
        entityId: params.entityId,
        createdAt: { gte: new Date(Date.now() - DEDUP_WINDOW_MS) },
      },
    });
    if (existing) return existing;
  }

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

/**
 * Scoped to the same visibility rule as listNotifications (own or
 * org-wide broadcast) - without the userId check here, any member could
 * mark another specific member's personal notification as read by id,
 * even though they could never see it via listNotifications.
 */
export async function markNotificationRead(
  organizationId: string,
  userId: string,
  id: string
) {
  return prisma.notification.updateMany({
    where: {
      id,
      organizationId,
      OR: [{ userId }, { userId: null }],
      readAt: null,
    },
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
