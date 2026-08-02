import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  getDecision,
  updateDecisionStatus,
} from "@/features/brain/decisions/decision.service";
import { updateDecisionStatusSchema } from "@/features/brain/decisions/schemas";
import {
  unauthorizedResponse,
  forbiddenResponse,
  notFoundResponse,
  badRequestResponse,
  internalErrorResponse,
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

    const decision = await getDecision(membership.organizationId, id);
    if (!decision) return notFoundResponse("Decision not found");

    return NextResponse.json({ data: decision });
  } catch (error) {
    return internalErrorResponse(
      "Decision GET",
      error,
      "Failed to load decision"
    );
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

    const parsed = updateDecisionStatusSchema.safeParse(body);
    if (!parsed.success) return badRequestResponse("Invalid input");

    const updated = await updateDecisionStatus(
      membership.organizationId,
      id,
      parsed.data.status,
      parsed.data.outcome
    );
    if (!updated) return notFoundResponse("Decision not found");

    return NextResponse.json({ data: { id, status: parsed.data.status } });
  } catch (error) {
    return internalErrorResponse(
      "Decision PATCH",
      error,
      "Failed to update decision"
    );
  }
}
