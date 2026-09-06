import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { markNotificationRead } from "@/features/radar/notifications/notification.service";
import {
  forbiddenResponse,
  internalErrorResponse,
  notFoundResponse,
  unauthorizedResponse,
} from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    const result = await markNotificationRead(
      membership.organizationId,
      user.id,
      id
    );
    if (result.count === 0) {
      return notFoundResponse("Notification not found or already read");
    }

    return NextResponse.json({ data: { id, read: true } });
  } catch (error) {
    return internalErrorResponse(
      "Notification read POST",
      error,
      "Failed to mark notification read"
    );
  }
}
