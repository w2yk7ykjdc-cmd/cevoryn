import "server-only";

import type { Prisma } from "@prisma/client";

import { captureServerError } from "@/lib/error-reporting";
import { prisma } from "@/lib/prisma";

interface CreateRomanceNotificationParams {
  playerId: string;
  title: string;
  body: string;
  payload?: Record<string, unknown>;
}

/**
 * Product Bible §15 / "Retention philosophy": every notification must
 * cite a real, specific story fact - never a generic "come back!" push.
 * There is no scheduler or push-delivery here (that's explicitly a
 * separate, bigger concern) - this is the in-app notification record
 * itself, written at the moment a real fact becomes true (a bargain
 * sealed, a beat advanced, premium unlocked) and read via the bell in
 * RomanceShell. Best-effort: a write failure must never break the story
 * action that triggered it.
 */
export async function createRomanceNotification(
  params: CreateRomanceNotificationParams
): Promise<void> {
  try {
    await prisma.romanceNotification.create({
      data: {
        playerId: params.playerId,
        title: params.title,
        body: params.body,
        payload: (params.payload ?? {}) as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    captureServerError("romance-notification", error, { playerId: params.playerId });
  }
}

const MAX_ROMANCE_NOTIFICATION_PAGE_SIZE = 50;

export async function listRomanceNotifications(
  playerId: string,
  options: { take?: number } = {}
) {
  const take = Math.min(options.take ?? 20, MAX_ROMANCE_NOTIFICATION_PAGE_SIZE);
  return prisma.romanceNotification.findMany({
    where: { playerId },
    orderBy: { createdAt: "desc" },
    take,
  });
}

export async function countUnreadRomanceNotifications(playerId: string): Promise<number> {
  return prisma.romanceNotification.count({ where: { playerId, isRead: false } });
}

/** Tenant-scoped in the WHERE clause (not checked after the fact) - a notificationId belonging to another player updates zero rows, never theirs. */
export async function markRomanceNotificationRead(
  playerId: string,
  notificationId: string
): Promise<void> {
  await prisma.romanceNotification.updateMany({
    where: { id: notificationId, playerId },
    data: { isRead: true },
  });
}

export async function markAllRomanceNotificationsRead(playerId: string): Promise<void> {
  await prisma.romanceNotification.updateMany({
    where: { playerId, isRead: false },
    data: { isRead: true },
  });
}
