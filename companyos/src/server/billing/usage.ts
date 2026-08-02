import type { Prisma, UsageMetric } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { getSubscriptionForOrg } from "@/server/billing/subscription";
import { publishEvent } from "@/server/events/event-bus";

export class UsageLimitExceededError extends Error {
  constructor(
    public readonly metric: UsageMetric,
    public readonly limit: number,
    public readonly current: number,
  ) {
    super(`Usage limit exceeded for "${metric}": ${current}/${limit} used this billing period`);
    this.name = "UsageLimitExceededError";
  }
}

/** Appends one usage ledger entry. A no-op for non-positive quantities (nothing to bill). */
export async function recordUsage(
  organizationId: string,
  metric: UsageMetric,
  quantity: number,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  if (quantity <= 0) return;
  await prisma.usageRecord.create({
    data: { organizationId, metric, quantity, metadata: metadata as Prisma.InputJsonValue },
  });
}

/** Sums usage for `metric` within the organization's current billing period (its active `Subscription` window). */
export async function getCurrentPeriodUsage(organizationId: string, metric: UsageMetric): Promise<number> {
  const subscription = await getSubscriptionForOrg(organizationId);
  const result = await prisma.usageRecord.aggregate({
    where: {
      organizationId,
      metric,
      createdAt: { gte: subscription.currentPeriodStart, lt: subscription.currentPeriodEnd },
    },
    _sum: { quantity: true },
  });
  return result._sum.quantity ?? 0;
}

/**
 * Throws `UsageLimitExceededError` if the organization has already used up
 * its plan's allowance for `metric` this billing period. Call this BEFORE
 * starting the expensive work (an AI call, an agent run) so a maxed-out
 * organization is stopped up front rather than after the cost is incurred —
 * the same "halt before doing more damage" principle Sprint 2's agent
 * executor uses for tool failures.
 */
export async function checkUsageLimit(organizationId: string, metric: UsageMetric): Promise<void> {
  const subscription = await getSubscriptionForOrg(organizationId);
  const limit = metric === "ai_tokens" ? subscription.plan.aiTokenLimit : subscription.plan.agentRunLimit;
  const current = await getCurrentPeriodUsage(organizationId, metric);

  if (current >= limit) {
    await publishEvent("billing.usage_limit_exceeded", { organizationId, metric, limit, current }, { organizationId });
    throw new UsageLimitExceededError(metric, limit, current);
  }
}

export type UsageSummary = {
  metric: UsageMetric;
  used: number;
  limit: number;
};

/** Convenience read for the billing dashboard: both metered metrics against the org's current plan. */
export async function getUsageSummary(organizationId: string): Promise<UsageSummary[]> {
  const subscription = await getSubscriptionForOrg(organizationId);
  const [aiTokens, agentRuns] = await Promise.all([
    getCurrentPeriodUsage(organizationId, "ai_tokens"),
    getCurrentPeriodUsage(organizationId, "agent_run"),
  ]);

  return [
    { metric: "ai_tokens", used: aiTokens, limit: subscription.plan.aiTokenLimit },
    { metric: "agent_run", used: agentRuns, limit: subscription.plan.agentRunLimit },
  ];
}
