import { NextResponse } from "next/server";

import {
  getDecisionStats,
  listDecisions,
} from "@/features/brain/decisions/decision.service";
import { parseDecisionCanvas } from "@/features/brain/decisions/json-schemas";
import {
  unauthorizedResponse,
  forbiddenResponse,
  internalErrorResponse,
} from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";

export async function GET() {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    const [pendingDecisions, stats] = await Promise.all([
      listDecisions(membership.organizationId, {
        status: "PROPOSED",
        limit: 10,
      }),
      getDecisionStats(membership.organizationId),
    ]);

    const recommendations = pendingDecisions.flatMap(
      (d: {
        id: string;
        canvas: unknown;
        priorityScore: number;
        status: string;
        createdAt: Date;
      }) => {
        const canvas = parseDecisionCanvas(d.canvas);
        if (!canvas) return [];
        return [
          {
            id: d.id,
            problemStatement: canvas.problemStatement,
            recommendedDecision: canvas.recommendedDecision,
            priorityScore: d.priorityScore,
            confidenceScore: canvas.confidenceScore,
            status: d.status,
            createdAt: d.createdAt.toISOString(),
          },
        ];
      }
    );

    return NextResponse.json({ data: { recommendations, stats } });
  } catch (error) {
    return internalErrorResponse(
      "Recommendations",
      error,
      "Failed to load recommendations"
    );
  }
}
