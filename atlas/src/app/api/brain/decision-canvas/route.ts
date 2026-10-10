import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { runWithAIUsageContext } from "@/features/ai/usage-context";
import { generateDecisionCanvas } from "@/features/brain/decisions/decision-canvas";
import { createDecisionSchema } from "@/features/brain/decisions/schemas";
import { internalErrorResponse } from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import {
  assertAiTokenCapacity,
  PlanLimitError,
} from "@/server/services/entitlement.service";
import { checkRateLimit } from "@/server/services/rate-limit.service";

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

  let body: unknown;
  try {
    body = await request.json();
  } catch (_error) {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: "Invalid body" } },
      { status: 400 }
    );
  }

  if (!hasPermission(membership.role, "ai:use")) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Insufficient permissions" } },
      { status: 403 }
    );
  }

  const parsed = createDecisionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid input" } },
      { status: 400 }
    );
  }

  // This route calls the AI provider directly (generateDecisionCanvas), so
  // it needs the same cost/abuse gates as the other AI-calling brain
  // routes (decisions, insights, brief) - without them, any authenticated
  // org member could call it repeatedly with no limit on AI spend.
  try {
    await assertAiTokenCapacity(membership.organizationId);
  } catch (error) {
    if (error instanceof PlanLimitError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: 429 }
      );
    }
    throw error;
  }

  const rateLimit = await checkRateLimit(membership.organizationId, user.id);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: {
          code: "RATE_LIMITED",
          message:
            rateLimit.exceededScope === "user"
              ? "Your daily AI usage limit has been reached"
              : "Daily token limit reached",
        },
      },
      { status: 429 }
    );
  }

  try {
    const envelope = await runWithAIUsageContext(
      { organizationId: membership.organizationId, userId: user.id },
      () =>
        generateDecisionCanvas({
          organizationId: membership.organizationId,
          problemDescription: parsed.data.problemDescription,
          evidence: [],
        })
    );

    return NextResponse.json({
      data: {
        canvas: envelope.data,
        trust: {
          confidence: envelope.confidence,
          reasoning: envelope.reasoning,
          missingInformation: envelope.missingInformation,
          dataFreshness: envelope.dataFreshness,
        },
      },
    });
  } catch (error) {
    return internalErrorResponse(
      "Decision canvas POST",
      error,
      "Failed to generate decision canvas"
    );
  }
}
