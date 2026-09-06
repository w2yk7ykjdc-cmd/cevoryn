import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { runRadarPipelineForAllOrganizations } from "@/features/radar/radar-pipeline.service";
import { internalErrorResponse } from "@/lib/api-utils";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Scheduled Radar pipeline run: Signal ingestion -> Event extraction ->
 * Opportunity generation -> Notification, for every organization with
 * RADAR plan access and an active watchlist. Configured to run daily via
 * vercel.json's "crons" entry.
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
    const results = await runRadarPipelineForAllOrganizations();

    const totalErrors = results.flatMap((r) =>
      r.errors.map((e) => `${r.organizationId}: ${e}`)
    );
    if (totalErrors.length > 0) {
      console.warn("[cevoryn:radar-cron] partial errors", totalErrors);
    }

    return NextResponse.json({
      data: {
        organizationsProcessed: results.length,
        signalsIngested: results.reduce((sum, r) => sum + r.signalsIngested, 0),
        eventsCreated: results.reduce((sum, r) => sum + r.eventsCreated, 0),
        opportunitiesCreated: results.reduce(
          (sum, r) => sum + r.opportunitiesCreated,
          0
        ),
        errorCount: totalErrors.length,
      },
    });
  } catch (error) {
    return internalErrorResponse(
      "Cron radar-ingest",
      error,
      "Failed to run Radar pipeline"
    );
  }
}
