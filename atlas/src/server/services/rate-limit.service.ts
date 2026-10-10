import "server-only";

import { getOrgUsage, getUserUsage } from "@/features/ai/engine/token-tracker";
import { AI_CONFIG } from "@/lib/constants";
import type { RateLimitResult } from "@/types";

/**
 * Check whether an organization, and the requesting user within it, are
 * within their daily token budgets.
 *
 * Uses the UsageRecord table — works correctly across multiple
 * server instances (unlike in-memory counters).
 *
 * This is an advisory pre-check, not an atomic reservation: it has the
 * same check-then-act race any plain read has under concurrent requests.
 * The chat route closes that race for its own path by folding the same
 * two checks into entitlement.service.ts's reserveAiTokenCapacity, which
 * runs under a per-organization advisory lock. The other AI-calling
 * routes (brief/insights/decisions/decision-canvas) call this directly as
 * a best-effort guard, same as their pre-existing (unfixed) exposure on
 * the monthly cap via assertAiTokenCapacity.
 */
export async function checkRateLimit(
  organizationId: string,
  userId: string
): Promise<RateLimitResult> {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  const resetAt = new Date(startOfDay);
  resetAt.setDate(resetAt.getDate() + 1);

  const [orgUsed, userUsed] = await Promise.all([
    getOrgUsage(organizationId, startOfDay),
    getUserUsage(organizationId, userId, startOfDay),
  ]);

  const orgLimit = AI_CONFIG.dailyTokenLimitPerOrg;
  const userLimit = AI_CONFIG.dailyTokenLimitPerUser;

  const orgExceeded = orgUsed >= orgLimit;
  const userExceeded = userUsed >= userLimit;

  return {
    allowed: !orgExceeded && !userExceeded,
    remaining: Math.max(0, Math.min(orgLimit - orgUsed, userLimit - userUsed)),
    dailyLimit: orgLimit,
    resetAt,
    exceededScope: orgExceeded ? "organization" : userExceeded ? "user" : null,
  };
}
