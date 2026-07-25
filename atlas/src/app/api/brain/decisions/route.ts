import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { runWithAIUsageContext } from "@/features/ai/usage-context";
import { executeDecisionPipeline } from "@/features/brain/decisions/decision-engine";
import {
  createDecision,
  listDecisions,
} from "@/features/brain/decisions/decision.service";
import { createDecisionSchema } from "@/features/brain/decisions/schemas";
import type { DecisionCanvas } from "@/features/brain/decisions/types";
import {
  unauthorizedResponse,
  forbiddenResponse,
  badRequestResponse,
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
    const status = url.searchParams.get("status") ?? undefined;
    const decisions = await listDecisions(membership.organizationId, { status });

    return NextResponse.json({ data: decisions });
  } catch (error) {
    return internalErrorResponse(
      "Decisions GET",
      error,
      "Failed to load decisions"
    );
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

    let body: unknown;
    try {
      body = await request.json();
    } catch (_error) {
      return badRequestResponse("Invalid body");
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
      const canvas = createFallbackCanvas(parsed.data.problemDescription);
      const decision = await createDecision({
        organizationId: membership.organizationId,
        canvas,
        priorityScore: canvas.priorityScore,
      });

      return NextResponse.json(
        {
          data: {
            decisionId: decision.id,
            canvas,
            actionsGenerated: 0,
            trust: {
              confidence: canvas.confidenceScore,
              reasoning:
                "Decision saved without AI analysis because the daily AI limit was reached.",
              missingInformation: [
                "Full AI analysis will be available after the usage limit resets.",
              ],
              dataFreshness: "current",
            },
            degraded: true,
          },
        },
        { status: 201 }
      );
    }

    const result = await runWithAIUsageContext(
      {
        organizationId: membership.organizationId,
        userId: user.id,
      },
      () =>
        executeDecisionPipeline({
          organizationId: membership.organizationId,
          problemDescription: parsed.data.problemDescription,
          sourceInsightId: parsed.data.sourceInsightId,
        })
    );

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
    return internalErrorResponse(
      "Decisions POST",
      error,
      "Failed to process decision request"
    );
  }
}

function createFallbackCanvas(problemDescription: string): DecisionCanvas {
  return {
    executiveSummary:
      "The decision has been recorded and is ready for review. Full AI analysis is temporarily unavailable.",
    problemStatement: problemDescription,
    evidence: [],
    possibleCauses: [],
    businessImpact: "Business impact requires review.",
    priorityScore: 5,
    scoringBreakdown: [],
    options: [],
    recommendedDecision:
      "Review the available facts, identify the largest risk, and choose the next reversible step.",
    confidenceScore: 0.2,
    expectedOutcome: "A clear next step is selected and tracked.",
    followUpPlan: [
      "Gather the missing facts",
      "Review the decision with the responsible owner",
      "Record the selected outcome",
    ],
  };
}
