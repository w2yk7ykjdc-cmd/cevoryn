import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getMembership, getUser } from "@/lib/auth";
import { unauthorizedResponse, forbiddenResponse, badRequestResponse, notFoundResponse } from "@/lib/api-utils";
import { getDecisionTimeline } from "@/features/brain/decisions/decision.service";

export async function GET(request: NextRequest) {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    const url = new URL(request.url);
    const decisionId = url.searchParams.get("decisionId");
    if (!decisionId) return badRequestResponse("decisionId is required");

    const timeline = await getDecisionTimeline(membership.organizationId, decisionId);
    if (!timeline) return notFoundResponse("Decision not found");

    return NextResponse.json({ data: timeline });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Internal error";
    console.error("Timeline error:", msg);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to load timeline" } },
      { status: 500 }
    );
  }
}
