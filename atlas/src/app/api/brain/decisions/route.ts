import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { executeDecisionPipeline } from "@/features/brain/decisions/decision-engine";
import {
  createDecision,
  listDecisions,
} from "@/features/brain/decisions/decision.service";
import { createDecisionSchema } from "@/features/brain/decisions/schemas";
import type { DecisionCanvas } from "@/features/brain/decisions/types";
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
