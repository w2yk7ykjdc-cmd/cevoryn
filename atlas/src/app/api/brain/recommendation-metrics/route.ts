import { NextResponse } from "next/server";

import { getMembership, getUser } from "@/lib/auth";
import { unauthorizedResponse, forbiddenResponse } from "@/lib/api-utils";
import { computeRecommendationMetrics } from "@/features/brain/learning/analytics";

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
    const msg = error instanceof Error ? error.message : "Internal error";
    console.error("Recommendation metrics error:", msg);
    return NextResponse.json(
      {
        error: { code: "INTERNAL_ERROR", message: "Failed to compute metrics" },
      },
      { status: 500 }
    );
  }
}
