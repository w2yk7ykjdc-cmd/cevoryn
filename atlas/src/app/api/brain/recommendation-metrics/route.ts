import { NextResponse } from "next/server";

import { computeRecommendationMetrics } from "@/features/brain/learning/analytics";
import {
  unauthorizedResponse,
  forbiddenResponse,
  internalErrorResponse,
} from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";

export async function GET() {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    const metrics = await computeRecommendationMetrics(
      membership.organizationId
    );
    return NextResponse.json({ data: metrics });
  } catch (error) {
    return internalErrorResponse(
      "Recommendation metrics",
      error,
      "Failed to compute metrics"
    );
  }
}
