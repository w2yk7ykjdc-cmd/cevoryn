import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  getPreparedAction,
  updateActionStatus,
} from "@/features/brain/actions/action.service";
import { updateActionStatusSchema } from "@/features/brain/actions/schemas";
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

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    const action = await getPreparedAction(membership.organizationId, id);
    if (!action) return notFoundResponse("Action not found");

    return NextResponse.json({ data: action });
  } catch (error) {
    return internalErrorResponse("Action GET", error, "Failed to load action");
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
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

    const parsed = updateActionStatusSchema.safeParse(body);
    if (!parsed.success) return badRequestResponse("Invalid status");

    const result = await updateActionStatus(
      membership.organizationId,
      id,
      parsed.data.status
    );

    if (result.count === 0) return notFoundResponse("Action not found");

    return NextResponse.json({ data: { id, status: parsed.data.status } });
  } catch (error) {
    return internalErrorResponse(
      "Action PATCH",
      error,
      "Failed to update action"
    );
  }
}
