import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getMembership, getUser } from "@/lib/auth";
import { unauthorizedResponse, forbiddenResponse } from "@/lib/api-utils";
import { listPreparedActions } from "@/features/brain/actions/action.service";

export async function GET(request: NextRequest) {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    const url = new URL(request.url);
    const status = url.searchParams.get("status") ?? undefined;

    const actions = await listPreparedActions(
      membership.organizationId,
      status
    );
    return NextResponse.json({ data: actions });
  } catch (error) {
    console.error(
      "Actions GET error:",
      error instanceof Error ? error.message : "unknown"
    );
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to load actions" } },
      { status: 500 }
    );
  }
}
