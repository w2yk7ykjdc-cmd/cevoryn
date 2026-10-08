"use server";

import type { ActionResult } from "@/types";

import { getAdultRomancePlayerOrThrow } from "../../player/romance-player-guards";
import {
  markAllRomanceNotificationsRead,
  markRomanceNotificationRead,
} from "../romance-notification.service";

export async function markNotificationReadAction(
  notificationId: string
): Promise<ActionResult> {
  const { player } = await getAdultRomancePlayerOrThrow();
  await markRomanceNotificationRead(player.id, notificationId);
  return { success: true, data: undefined };
}

export async function markAllNotificationsReadAction(): Promise<ActionResult> {
  const { player } = await getAdultRomancePlayerOrThrow();
  await markAllRomanceNotificationsRead(player.id);
  return { success: true, data: undefined };
}
