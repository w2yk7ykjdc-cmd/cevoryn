import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  generateBrief,
  getLatestBrief,
  listBriefs,
} from "@/features/brain/brief/brief.service";
import { getMembership, getUser } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { checkRateLimit } from "@/server/services/rate-limit.service";

function internalError(message: string) {
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message } },
    { status: 500 }
  );
}

export async function GET(request: NextRequest) {
  try {
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

    const url = new URL(request.url);
    const mode = url.searchParams.get("mode");

    if (mode === "latest") {
      const type = url.searchParams.get("type") === "WEEKLY" ? "WEEKLY" : "DAILY";
      const brief = await getLatestBrief(membership.organizationId, type);

      if (!brief) {
        return NextResponse.json(
          { error: { code: "NOT_FOUND", message: "No brief found" } },
          { status: 404 }
        );
      }

      return NextResponse.json({ data: brief });
    }

    const briefs = await listBriefs(membership.organizationId);
    return NextResponse.json({ data: briefs });
  } catch (error) {
    console.error(
      "Brief GET error:",
      error instanceof Error ? error.message : "unknown"
    );
    return internalError("Failed to load briefs");
  }
}

export async function POST(request: NextRequest) {
  try {
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

    if (!hasPermission(membership.role, "dashboard:read")) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Insufficient permissions" } },
        { status: 403 }
      );
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
    console.error(
      "Brief POST error:",
      error instanceof Error ? error.message : "unknown"
    );
    return internalError("Failed to generate brief");
  }
}
