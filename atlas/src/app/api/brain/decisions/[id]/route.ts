import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  getDecision,
  updateDecisionStatus,
} from "@/features/brain/decisions/decision.service";
import { updateDecisionStatusSchema } from "@/features/brain/decisions/schemas";
import { evaluateOutcome } from "@/features/brain/outcomes/outcome-evaluator";
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
    if (!updated) {
      // updateDecisionStatus's `count === 0` now means either "no such
      // decision" or "found, but this status change isn't a valid
      // transition from its current status" (see
      // decision.service.ts::VALID_SOURCE_STATUSES) - distinguish them so
      // a real illegal-transition attempt isn't reported as a 404.
      const existing = await getDecision(membership.organizationId, id);
      if (!existing) return notFoundResponse("Decision not found");
      return badRequestResponse(
        `Cannot change decision status from ${existing.status} to ${parsed.data.status}`
      );
    }

    // Reuses the existing outcome-evaluator.ts pipeline (the same function
    // /api/brain/outcomes already calls for this status) rather than a
    // second parallel evaluation path - see the audit finding that this
    // route previously left evaluateOutcome() unreachable from the
    // shipped Decision-completion UI (decision-queue.tsx). evaluateOutcome
    // never throws (it catches its own errors and returns null), so this
    // can't turn a successful status update into a failed response.
    let evaluation = null;
    if (parsed.data.status === "COMPLETED") {
      evaluation = await evaluateOutcome(membership.organizationId, id);
    }

    return NextResponse.json({
      data: { id, status: parsed.data.status, evaluation },
    });
  } catch (error) {
    return internalErrorResponse(
      "Decision PATCH",
      error,
      "Failed to update decision"
    );
  }
}
