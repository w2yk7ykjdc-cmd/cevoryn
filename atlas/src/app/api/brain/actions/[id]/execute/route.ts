import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { recordActionExecution } from "@/features/brain/actions/action.service";
import { recordActionExecutionSchema } from "@/features/brain/actions/schemas";
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

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    if (!hasPermission(membership.role, "ai:use")) {
      return forbiddenResponse("Insufficient permissions");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch (_error) {
      return badRequestResponse("Invalid body");
    }

    const parsed = recordActionExecutionSchema.safeParse(body);
    if (!parsed.success) return badRequestResponse("Invalid execution record");

    const execution = await recordActionExecution({
      organizationId: membership.organizationId,
      preparedActionId: id,
      channel: parsed.data.channel,
      status: parsed.data.status,
      error: parsed.data.error,
    });
    if (!execution) return notFoundResponse("Action not found");

    return NextResponse.json({ data: execution }, { status: 201 });
  } catch (error) {
    return internalErrorResponse(
      "Action execute POST",
      error,
      "Failed to record action execution"
    );
  }
}
