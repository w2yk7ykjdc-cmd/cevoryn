import { NextResponse } from "next/server";

import { markAllNotificationsRead } from "@/features/radar/notifications/notification.service";
import {
  forbiddenResponse,
  internalErrorResponse,
  unauthorizedResponse,
} from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";

export async function POST() {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    const result = await markAllNotificationsRead(
      membership.organizationId,
      user.id
    );

    return NextResponse.json({ data: { updated: result.count } });
  } catch (error) {
    return internalErrorResponse(
      "Notifications read-all POST",
      error,
      "Failed to mark notifications read"
    );
  }
}
