import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getMembership, getUser } from "@/lib/auth";
import { updateActionStatus } from "@/features/brain/actions/action.service";
import { updateActionStatusSchema } from "@/features/brain/actions/schemas";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
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

  await updateActionStatus(membership.organizationId, id, parsed.data.status);

  return NextResponse.json({
    data: { id, status: parsed.data.status },
  });
}
