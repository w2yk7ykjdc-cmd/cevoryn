import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { updateActionStatus } from "@/features/brain/actions/action.service";
import { updateActionStatusSchema } from "@/features/brain/actions/schemas";
import { getMembership, getUser } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Not authenticated" } },
        { status: 401 }
      );
    }

    const membership = await getMembership(user.id);
    if (!membership) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "No organization" } },
        { status: 403 }
      );
    }

    if (!hasPermission(membership.role, "ai:use")) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Insufficient permissions" } },
        { status: 403 }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch (_error) {
      return NextResponse.json(
        { error: { code: "INVALID_JSON", message: "Invalid body" } },
        { status: 400 }
      );
    }

    const parsed = updateActionStatusSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "Invalid status" } },
        { status: 400 }
      );
    }

    const result = await updateActionStatus(
      membership.organizationId,
      id,
      parsed.data.status
    );

    if (result.count === 0) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Action not found" } },
        { status: 404 }
      );
    }

    return NextResponse.json({
      data: { id, status: parsed.data.status },
    });
  } catch (error) {
    console.error(
      "Action PATCH error:",
      error instanceof Error ? error.message : "unknown"
    );
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to update action" } },
      { status: 500 }
    );
  }
}
