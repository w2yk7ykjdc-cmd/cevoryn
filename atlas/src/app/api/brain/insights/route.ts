import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  generateInsights,
  listInsights,
  updateInsightStatus,
} from "@/features/brain/insights/insight.service";
import { updateInsightStatusSchema } from "@/features/brain/insights/schemas";
import {
  unauthorizedResponse,
  forbiddenResponse,
  badRequestResponse,
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
    const status = url.searchParams.get("status") ?? undefined;
    const insights = await listInsights(membership.organizationId, { status });
    return NextResponse.json({ data: insights });
  } catch (error) {
    console.error(
      "Insights GET error:",
      error instanceof Error ? error.message : "unknown"
    );
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to load insights" } },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();
    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    if (!hasPermission(membership.role, "ai:use")) {
      return forbiddenResponse("Insufficient permissions");
    }

    const rateLimit = await checkRateLimit(membership.organizationId);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: { code: "RATE_LIMITED", message: "Daily token limit reached" } },
        { status: 429 }
      );
    }

    const created = await generateInsights(membership.organizationId);
    return NextResponse.json({ data: { generated: created } });
  } catch (error) {
    console.error(
      "Insights POST error:",
      error instanceof Error ? error.message : "unknown"
    );
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to generate insights",
        },
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();
    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    if (!hasPermission(membership.role, "ai:use")) {
      return forbiddenResponse("Insufficient permissions");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch (_error) {
      return badRequestResponse("Invalid body");
    }

    const parsed = updateInsightStatusSchema.safeParse(body);
    if (!parsed.success) return badRequestResponse("Invalid input");

    await updateInsightStatus(
      membership.organizationId,
      parsed.data.id,
      parsed.data.status
    );
    return NextResponse.json({
      data: { id: parsed.data.id, status: parsed.data.status },
    });
  } catch (error) {
    console.error(
      "Insights PATCH error:",
      error instanceof Error ? error.message : "unknown"
    );
    return NextResponse.json(
      {
        error: { code: "INTERNAL_ERROR", message: "Failed to update insight" },
      },
      { status: 500 }
    );
  }
}
