import "server-only";

import type { AnalyticsEventName } from "@/features/executive/types";
import { prisma } from "@/lib/prisma";

interface AnalyticsPayload {
  event: AnalyticsEventName;
  organizationId: string;
  userId: string;
  metadata?: Record<string, string | number | boolean>;
}

/**
 * Persist an analytics event. Call from server actions or API routes.
 * Failures are logged but never thrown — analytics must never block the user.
 */
export async function trackEvent(payload: AnalyticsPayload): Promise<void> {
  try {
    await prisma.analyticsEvent.create({
      data: {
        organizationId: payload.organizationId,
        userId: payload.userId,
        event: payload.event,
        metadata: payload.metadata ?? undefined,
      },
    });
  } catch (error) {
    console.error("[cevoryn:analytics] Failed to persist event", {
      event: payload.event,
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
