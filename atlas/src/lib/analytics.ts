import type { AnalyticsEventName } from "@/features/executive/types";

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
