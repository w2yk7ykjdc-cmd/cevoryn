import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getMembership, getUser } from "@/lib/auth";
import {
  unauthorizedResponse,
  forbiddenResponse,
  notFoundResponse,
  badRequestResponse,
} from "@/lib/api-utils";
import {
  getDecision,
  updateDecisionStatus,
} from "@/features/brain/decisions/decision.service";
import { updateDecisionStatusSchema } from "@/features/brain/decisions/schemas";

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
    console.error(
      "Decision GET error:",
      error instanceof Error ? error.message : "unknown"
    );
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to load decision" } },
      { status: 500 }
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

    let body: unknown;
    try {
      body = await request.json();
    } catch (_error) {
      return badRequestResponse("Invalid body");
    }

    const parsed = updateDecisionStatusSchema.safeParse(body);
    if (!parsed.success) return badRequestResponse("Invalid input");

    await updateDecisionStatus(
      membership.organizationId,
      id,
      parsed.data.status,
      parsed.data.outcome
    );
    return NextResponse.json({ data: { id, status: parsed.data.status } });
  } catch (error) {
    console.error(
      "Decision PATCH error:",
      error instanceof Error ? error.message : "unknown"
    );
    return NextResponse.json(
      {
        error: { code: "INTERNAL_ERROR", message: "Failed to update decision" },
      },
      { status: 500 }
    );
  }
}
