import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { evaluateOutcome } from "@/features/brain/outcomes/outcome-evaluator";
import {
  getDecisionLifecycle,
  transitionDecision,
} from "@/features/brain/outcomes/outcome.service";
import { recordOutcomeSchema } from "@/features/brain/outcomes/schemas";
import {
  unauthorizedResponse,
  forbiddenResponse,
  badRequestResponse,
  notFoundResponse,
} from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();
    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    const url = new URL(request.url);
    const decisionId = url.searchParams.get("decisionId");
    if (!decisionId) return badRequestResponse("decisionId required");

    const lifecycle = await getDecisionLifecycle(
      membership.organizationId,
      decisionId
    );
    if (!lifecycle) return notFoundResponse("Decision not found");

    return NextResponse.json({ data: lifecycle });
  } catch (error) {
    console.error(
      "Outcomes GET error:",
      error instanceof Error ? error.message : "unknown"
    );
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to load outcome" } },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();
    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    let body: unknown;
    try {
      body = await request.json();
    } catch (_error) {
      return badRequestResponse("Invalid body");
    }

    const parsed = recordOutcomeSchema.safeParse(body);
    if (!parsed.success) return badRequestResponse("Invalid input");

    const result = await transitionDecision(
      membership.organizationId,
      parsed.data.decisionId,
      parsed.data.status,
      parsed.data.outcome
    );

    if (!result.success)
      return badRequestResponse(result.error ?? "Invalid transition");

    let evaluation = null;
    if (["COMPLETED", "SUCCESSFUL", "FAILED"].includes(parsed.data.status)) {
      evaluation = await evaluateOutcome(
        membership.organizationId,
        parsed.data.decisionId
      );
    }

    return NextResponse.json({
      data: {
        decisionId: parsed.data.decisionId,
        status: parsed.data.status,
        evaluation,
      },
    });
  } catch (error) {
    console.error(
      "Outcomes POST error:",
      error instanceof Error ? error.message : "unknown"
    );
    return NextResponse.json(
      {
        error: { code: "INTERNAL_ERROR", message: "Failed to record outcome" },
      },
      { status: 500 }
    );
  }
}
