import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getDecisionStats,
  listDecisions,
} from "@/features/brain/decisions/decision.service";
import { unauthorizedResponse, forbiddenResponse } from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";

const decisionCanvasSummarySchema = z.object({
  problemStatement: z.string().default("Decision details unavailable"),
  recommendedDecision: z.string().default("No recommendation recorded"),
  confidenceScore: z.number().min(0).max(1).default(0),
});

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

    const recommendations = pendingDecisions.map(
      (d: {
        id: string;
        canvas: unknown;
        priorityScore: number;
        status: string;
        createdAt: Date;
      }) => {
        const canvas = decisionCanvasSummarySchema.safeParse(d.canvas);
        const summary = canvas.success
          ? canvas.data
          : decisionCanvasSummarySchema.parse({});
        return {
          id: d.id,
          problemStatement: summary.problemStatement,
          recommendedDecision: summary.recommendedDecision,
          priorityScore: d.priorityScore,
          confidenceScore: summary.confidenceScore,
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
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to load recommendations",
        },
      },
      { status: 500 }
    );
  }
}
