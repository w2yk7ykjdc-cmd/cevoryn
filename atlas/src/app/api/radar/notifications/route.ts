import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  countUnreadNotifications,
  listNotifications,
} from "@/features/radar/notifications/notification.service";
import {
  forbiddenResponse,
  internalErrorResponse,
  unauthorizedResponse,
} from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    const unreadOnly =
      new URL(request.url).searchParams.get("unreadOnly") === "true";

    const [notifications, unreadCount] = await Promise.all([
      listNotifications(membership.organizationId, user.id, { unreadOnly }),
      countUnreadNotifications(membership.organizationId, user.id),
    ]);

    return NextResponse.json({ data: { notifications, unreadCount } });
  } catch (error) {
    return internalErrorResponse(
      "Notifications GET",
      error,
      "Failed to load notifications"
    );
  }
}
