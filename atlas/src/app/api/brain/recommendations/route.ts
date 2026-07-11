import { NextResponse } from "next/server";

import { getMembership, getUser } from "@/lib/auth";
import { unauthorizedResponse, forbiddenResponse } from "@/lib/api-utils";
import {
  getDecisionStats,
  listDecisions,
} from "@/features/brain/decisions/decision.service";
import type { DecisionCanvas } from "@/features/brain/decisions/types";

export async function GET() {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    const [pendingDecisions, stats] = await Promise.all([
      listDecisions(membership.organizationId, { status: "PROPOSED", limit: 10 }),
      getDecisionStats(membership.organizationId),
    ]);

    const recommendations = pendingDecisions.map(
      (d: { id: string; canvas: unknown; priorityScore: number; status: string; createdAt: Date }) => {
        const canvas = d.canvas as DecisionCanvas;
        return {
          id: d.id,
          problemStatement: canvas.problemStatement,
          recommendedDecision: canvas.recommendedDecision,
          priorityScore: d.priorityScore,
          confidenceScore: canvas.confidenceScore,
          status: d.status,
          createdAt: d.createdAt.toISOString(),
        };
      }
    );

    return NextResponse.json({ data: { recommendations, stats } });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Internal error";
    console.error("Recommendations error:", msg);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to load recommendations" } },
      { status: 500 }
    );
  }
}
