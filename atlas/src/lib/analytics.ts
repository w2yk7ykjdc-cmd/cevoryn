import type { AnalyticsEventName } from "@/features/executive/types";

/**
 * Analytics interface — first-party, privacy-conscious event tracking.
 *
 * Current implementation: server-side console logging.
 * Ready to swap for DB persistence or external provider.
 *
 * Events never contain sensitive company content —
 * only event names, timestamps, and anonymous org/user IDs.
 */

interface AnalyticsPayload {
  event: AnalyticsEventName;
  organizationId: string;
  userId: string;
  timestamp: string;
  metadata?: Record<string, string | number | boolean>;
}

/**
 * Track an analytics event.
 * Call from server actions or API routes.
 */
export function trackEvent(payload: AnalyticsPayload): void {
  // First-party persistence — structured log
  // In production, replace with DB insert or event queue
  if (process.env.NODE_ENV === "development") {
    console.warn(
      `[cevoryn:analytics] ${payload.event}`,
      JSON.stringify({
        org: payload.organizationId.slice(0, 8),
        ts: payload.timestamp,
        ...payload.metadata,
      })
    );
  }
}

/**
 * Client-safe wrapper — sends event to server.
 * Does NOT expose org/user IDs — those are added server-side.
 */
export async function sendAnalyticsEvent(
  event: AnalyticsEventName,
  metadata?: Record<string, string | number | boolean>
): Promise<void> {
  try {
    await fetch("/api/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, metadata }),
      keepalive: true,
    });
  } catch (_error) {
    // Analytics failures are silent — never block the user
  }
}
