import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { internalErrorResponse } from "@/lib/api-utils";
import { cleanupStaleAiTokenReservations } from "@/server/services/entitlement.service";

export const runtime = "nodejs";

/**
 * Scheduled cleanup for AI-token reservations orphaned by a serverless
 * function being killed (maxDuration timeout, platform restart, etc.)
 * between reserving capacity and reconciling it with real usage — see
 * entitlement.service.ts's cleanupStaleAiTokenReservations for the full
 * explanation. Configured to run daily via vercel.json's "crons" entry. New reservations also clean up expired placeholders for their own organization as a fast-path safeguard, so active organizations do not depend on the daily sweep.
 *
 * Vercel signs cron requests with an Authorization: Bearer header equal to
 * the CRON_SECRET environment variable — this route rejects anything else,
 * including unauthenticated manual requests.
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
    const deletedCount = await cleanupStaleAiTokenReservations();
    return NextResponse.json({ data: { deletedCount } });
  } catch (error) {
    return internalErrorResponse(
      "Cron cleanup-usage-reservations",
      error,
      "Failed to clean up stale usage reservations"
    );
  }
}
