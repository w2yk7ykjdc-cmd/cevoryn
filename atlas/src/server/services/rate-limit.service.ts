import "server-only";

import { getOrgUsage } from "@/features/ai/engine/token-tracker";
import { AI_CONFIG } from "@/lib/constants";
import type { RateLimitResult } from "@/types";

/**
 * Check whether an organization is within its daily token budget.
 *
 * Uses the UsageRecord table — works correctly across multiple
 * server instances (unlike in-memory counters).
 */
export async function checkRateLimit(
  organizationId: string
): Promise<RateLimitResult> {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  const resetAt = new Date(startOfDay);
  resetAt.setDate(resetAt.getDate() + 1);

  const used = await getOrgUsage(organizationId, startOfDay);
  const limit = AI_CONFIG.dailyTokenLimitPerOrg;
  const remaining = Math.max(0, limit - used);

  return {
    allowed: used < limit,
    remaining,
    dailyLimit: limit,
    resetAt,
  };
}
