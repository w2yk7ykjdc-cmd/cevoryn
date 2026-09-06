import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { listEvents } from "@/features/radar/events/event.service";
import {
  forbiddenResponse,
  internalErrorResponse,
  unauthorizedResponse,
} from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";

export async function GET(request: NextRequest) {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    if (!hasPermission(membership.role, "radar:read")) {
      return forbiddenResponse("Insufficient permissions");
    }

    const status = new URL(request.url).searchParams.get("status") ?? undefined;
    const events = await listEvents(membership.organizationId, { status });

    return NextResponse.json({ data: events });
  } catch (error) {
    return internalErrorResponse("Events GET", error, "Failed to load events");
  }
}
