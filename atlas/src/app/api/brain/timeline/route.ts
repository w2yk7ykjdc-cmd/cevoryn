import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getDecisionTimeline } from "@/features/brain/decisions/decision.service";
import {
  unauthorizedResponse,
  forbiddenResponse,
  badRequestResponse,
  notFoundResponse,
  internalErrorResponse,
} from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    const url = new URL(request.url);
    const decisionId = url.searchParams.get("decisionId");
    if (!decisionId) return badRequestResponse("decisionId is required");

    const timeline = await getDecisionTimeline(
      membership.organizationId,
      decisionId
    );
    if (!timeline) return notFoundResponse("Decision not found");

    return NextResponse.json({ data: timeline });
  } catch (error) {
    return internalErrorResponse("Timeline", error, "Failed to load timeline");
  }
}
