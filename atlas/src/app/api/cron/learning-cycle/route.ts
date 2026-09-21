import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { runLearningCycleForOrganization } from "@/features/brain/learning/learning-engine";
import { internalErrorResponse } from "@/lib/api-utils";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Scheduled learning cycle: extracts Decision patterns and computes +
 * durably persists both Decision- and Opportunity-domain confidence
 * calibration (see learning-engine.ts::runLearningCycleForOrganization).
 * Configured to run daily via vercel.json's "crons" entry, offset an hour
 * after radar-ingest so a day's WON/LOST/COMPLETED outcomes are already
 * recorded before this runs.
 *
 * Only organizations with at least one real OutcomeEvaluation row (either
 * domain) are processed - an organization with zero outcomes has nothing
 * to learn from yet, same "skip orgs with no relevant data" discipline
 * runRadarPipelineForAllOrganizations already applies for watchlists.
 *
 * Each organization's cycle is independently try/caught (mirroring
 * runRadarPipelineForAllOrganizations) so one organization's failure never
 * stops the rest from running; runLearningCycleForOrganization itself
 * additionally isolates its three internal steps the same way.
 *
 * Vercel signs cron requests with an Authorization: Bearer header equal to
 * the CRON_SECRET environment variable - this route rejects anything else,
 * matching the existing cron routes' auth pattern.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  const authHeader = request.headers.get("authorization");

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Not authenticated" } },
      { status: 401 }
    );
  }

  try {
    const organizations = await prisma.organization.findMany({
      where: { outcomeEvaluations: { some: {} } },
      select: { id: true },
    });

    let organizationsProcessed = 0;
    let patternsExtracted = 0;
    const errors: string[] = [];

    for (const organization of organizations) {
      try {
        const result = await runLearningCycleForOrganization(organization.id);
        organizationsProcessed++;
        patternsExtracted += result.patternsExtracted;
        errors.push(...result.errors.map((e) => `${organization.id}: ${e}`));
      } catch (error) {
        errors.push(
          `${organization.id}: ${error instanceof Error ? error.message : "unknown error"}`
        );
      }
    }

    if (errors.length > 0) {
      console.warn("[cevoryn:learning-cron] partial errors", errors);
    }

    return NextResponse.json({
      data: {
        organizationsEligible: organizations.length,
        organizationsProcessed,
        patternsExtracted,
        errorCount: errors.length,
      },
    });
  } catch (error) {
    return internalErrorResponse(
      "Cron learning-cycle",
      error,
      "Failed to run learning cycle"
    );
  }
}
