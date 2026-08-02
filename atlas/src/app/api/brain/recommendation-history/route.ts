import { NextResponse } from "next/server";

import { getRecommendationHistory } from "@/features/brain/learning/analytics";
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

    const history = await getRecommendationHistory(membership.organizationId);
    return NextResponse.json({ data: history });
  } catch (error) {
    return internalErrorResponse(
      "Recommendation history",
      error,
      "Failed to load history"
    );
  }
}
