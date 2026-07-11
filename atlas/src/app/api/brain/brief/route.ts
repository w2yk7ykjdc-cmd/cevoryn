import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getMembership, getUser } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { checkRateLimit } from "@/server/services/rate-limit.service";
import {
  generateBrief,
  getLatestBrief,
  listBriefs,
} from "@/features/brain/brief/brief.service";

export async function GET(request: NextRequest) {
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
    const type =
      url.searchParams.get("type") === "WEEKLY" ? "WEEKLY" : "DAILY";
    const brief = await getLatestBrief(
      membership.organizationId,
      type as "DAILY" | "WEEKLY"
    );

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
}

export async function POST(request: NextRequest) {
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
    // Default to daily
  }

  const rateLimit = await checkRateLimit(membership.organizationId);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "Daily token limit reached" } },
      { status: 429 }
    );
  }

  const type = body.type === "WEEKLY" ? "WEEKLY" : "DAILY";

  try {
    const result = await generateBrief(
      membership.organizationId,
      type as "DAILY" | "WEEKLY"
    );

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
    const msg =
      error instanceof Error ? error.message : "Brief generation failed";
    return NextResponse.json(
      { error: { code: "GENERATION_FAILED", message: msg } },
      { status: 500 }
    );
  }
}
