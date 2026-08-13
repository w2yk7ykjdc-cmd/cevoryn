import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { internalErrorResponse } from "@/lib/api-utils";
import { cleanupStaleAuthRateLimitAttempts } from "@/server/services/auth-rate-limit.service";
import { cleanupStaleBillingWebhookEvents } from "@/server/services/billing.service";

export const runtime = "nodejs";

/**
 * Scheduled cleanup for two tables that grow forever with no other
 * deletion path:
 *
 *  - auth_rate_limit_attempts: one row per login/signup/forgot-password/
 *    billing (checkout, portal, change-plan) attempt.
 *  - billing_webhook_events: one row per processed Polar webhook delivery,
 *    kept for ON CONFLICT idempotency dedup.
 *
 * Combined into one cron (rather than two separate ones, following
 * cleanup-usage-reservations's pattern) to stay within Vercel's per-plan
 * cron count limit alongside the existing cleanup-usage-reservations
 * cron - see each cleanup function's own docs (auth-rate-limit.service.ts,
 * billing.service.ts) for its retention window and reasoning. Configured
 * to run daily via vercel.json's "crons" entry.
 *
 * Vercel signs cron requests with an Authorization: Bearer header equal to
 * the CRON_SECRET environment variable - this route rejects anything else,
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
    const [authRateLimitDeletedCount, billingWebhookEventsDeletedCount] =
      await Promise.all([
        cleanupStaleAuthRateLimitAttempts(),
        cleanupStaleBillingWebhookEvents(),
      ]);
    return NextResponse.json({
      data: { authRateLimitDeletedCount, billingWebhookEventsDeletedCount },
    });
  } catch (error) {
    return internalErrorResponse(
      "Cron cleanup-billing-hardening-records",
      error,
      "Failed to clean up stale rate-limit/webhook-event records"
    );
  }
}
