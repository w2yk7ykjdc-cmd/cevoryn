import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { executeDecisionPipeline } from "@/features/brain/decisions/decision-engine";
import { listDecisions } from "@/features/brain/decisions/decision.service";
import { createDecisionSchema } from "@/features/brain/decisions/schemas";
import { getMembership, getUser } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { checkRateLimit } from "@/server/services/rate-limit.service";

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
    const status = url.searchParams.get("status") ?? undefined;
    const decisions = await listDecisions(membership.organizationId, { status });

    return NextResponse.json({ data: decisions });
  } catch (error) {
    console.error(
      "Decisions GET error:",
      error instanceof Error ? error.message : "unknown"
    );
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to load decisions" } },
      { status: 500 }
    );
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

    if (!hasPermission(membership.role, "ai:use")) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Insufficient permissions" } },
        { status: 403 }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch (_error) {
      return NextResponse.json(
        { error: { code: "INVALID_JSON", message: "Invalid body" } },
        { status: 400 }
      );
    }

    const parsed = createDecisionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid input",
            details: parsed.error.flatten().fieldErrors,
          },
        },
        { status: 400 }
      );
    }

    const rateLimit = await checkRateLimit(membership.organizationId);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: { code: "RATE_LIMITED", message: "Daily token limit reached" } },
        { status: 429 }
      );
    }

    const result = await executeDecisionPipeline({
      organizationId: membership.organizationId,
      problemDescription: parsed.data.problemDescription,
      sourceInsightId: parsed.data.sourceInsightId,
    });

    return NextResponse.json(
      {
        data: {
          decisionId: result.data.decisionId,
          canvas: result.data.canvas,
          actionsGenerated: result.data.actionsGenerated,
          trust: {
            confidence: result.confidence,
            reasoning: result.reasoning,
            missingInformation: result.missingInformation,
            dataFreshness: result.dataFreshness,
          },
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error(
      "Decisions POST error:",
      error instanceof Error ? error.message : "unknown"
    );
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to process decision request",
        },
      },
      { status: 500 }
    );
  }
}
