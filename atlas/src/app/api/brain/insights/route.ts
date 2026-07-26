import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { runWithAIUsageContext } from "@/features/ai/usage-context";
import { FeatureAccessError } from "@/features/billing/config/plans";
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
  notFoundResponse,
  internalErrorResponse,
} from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import {
  assertAiTokenCapacity,
  assertOrganizationFeatureAccess,
  PlanLimitError,
} from "@/server/services/entitlement.service";
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
    return internalErrorResponse("Insights GET", error, "Failed to load insights");
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

    try {
      await Promise.all([
        assertOrganizationFeatureAccess(membership.organizationId, "BRAIN"),
        assertAiTokenCapacity(membership.organizationId),
      ]);
    } catch (error) {
      if (error instanceof FeatureAccessError) {
        return NextResponse.json(
          {
            error: {
              code: error.code,
              message: "Brain insight generation requires the Professional or Business plan.",
            },
          },
          { status: 403 }
        );
      }
      if (error instanceof PlanLimitError) {
        return NextResponse.json(
          { error: { code: error.code, message: error.message } },
          { status: 429 }
        );
      }
      throw error;
    }

    const rateLimit = await checkRateLimit(membership.organizationId);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: { code: "RATE_LIMITED", message: "Daily token limit reached" } },
        { status: 429 }
      );
    }

    const created = await runWithAIUsageContext(
      {
        organizationId: membership.organizationId,
        userId: user.id,
      },
      () => generateInsights(membership.organizationId)
    );

    return NextResponse.json({ data: { generated: created } });
  } catch (error) {
    return internalErrorResponse(
      "Insights POST",
      error,
      "Failed to generate insights"
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

    const result = await updateInsightStatus(
      membership.organizationId,
      parsed.data.id,
      parsed.data.status
    );

    if (result.count === 0) return notFoundResponse("Insight not found");

    return NextResponse.json({
      data: { id: parsed.data.id, status: parsed.data.status },
    });
  } catch (error) {
    return internalErrorResponse(
      "Insights PATCH",
      error,
      "Failed to update insight"
    );
  }
}
