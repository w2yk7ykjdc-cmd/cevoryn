import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  generateBrief,
  getLatestBrief,
  listBriefs,
} from "@/features/brain/brief/brief.service";
import {
  unauthorizedResponse,
  forbiddenResponse,
  notFoundResponse,
  internalErrorResponse,
} from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { checkRateLimit } from "@/server/services/rate-limit.service";

export async function GET(request: NextRequest) {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    const url = new URL(request.url);
    const mode = url.searchParams.get("mode");

    if (mode === "latest") {
      const type = url.searchParams.get("type") === "WEEKLY" ? "WEEKLY" : "DAILY";
      const brief = await getLatestBrief(membership.organizationId, type);

      if (!brief) return notFoundResponse("No brief found");
      return NextResponse.json({ data: brief });
    }

    const briefs = await listBriefs(membership.organizationId);
    return NextResponse.json({ data: briefs });
  } catch (error) {
    return internalErrorResponse("Brief GET", error, "Failed to load briefs");
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    if (!hasPermission(membership.role, "ai:use")) {
      return forbiddenResponse("Insufficient permissions");
    }

    let body: { type?: string } = {};
    try {
      body = await request.json();
    } catch (_error) {
      // Empty or invalid JSON defaults to a daily brief.
    }

    const rateLimit = await checkRateLimit(membership.organizationId);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: { code: "RATE_LIMITED", message: "Daily token limit reached" } },
        { status: 429 }
      );
    }

    const type = body.type === "WEEKLY" ? "WEEKLY" : "DAILY";
    const result = await generateBrief(membership.organizationId, type);

    return NextResponse.json(
      {
        data: {
          id: result.id,
          sections: result.sections,
          trust: {
            confidence: result.trust.confidence,
            reasoning: result.trust.reasoning,
            missingInformation: result.trust.missingInformation,
            dataFreshness: result.trust.dataFreshness,
          },
        },
      },
      { status: 201 }
    );
  } catch (error) {
    return internalErrorResponse(
      "Brief POST",
      error,
      "Failed to generate brief"
    );
  }
}
