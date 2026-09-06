import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { updateEventStatus } from "@/features/radar/events/event.service";
import { updateEventStatusSchema } from "@/features/radar/events/schemas";
import {
  badRequestResponse,
  forbiddenResponse,
  internalErrorResponse,
  notFoundResponse,
  unauthorizedResponse,
} from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    if (!hasPermission(membership.role, "radar:manage")) {
      return forbiddenResponse("Insufficient permissions");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch (_error) {
      return badRequestResponse("Invalid body");
    }

    const parsed = updateEventStatusSchema.safeParse(body);
    if (!parsed.success) return badRequestResponse("Invalid status");

    const result = await updateEventStatus(
      membership.organizationId,
      id,
      parsed.data.status
    );
    if (result.count === 0) return notFoundResponse("Event not found");

    return NextResponse.json({ data: { id, status: parsed.data.status } });
  } catch (error) {
    return internalErrorResponse(
      "Event PATCH",
      error,
      "Failed to update event"
    );
  }
}
