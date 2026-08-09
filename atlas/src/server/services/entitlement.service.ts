import "server-only";

import {
  assertFeatureAccess,
  getPlanLimits,
  type BillingFeature,
  type BillingPlan,
  type PlanLimits,
} from "@/features/billing/config/plans";
import { isSubscriptionActive } from "@/features/billing/types";
import { prisma } from "@/lib/prisma";
import { getOrganizationSubscription } from "@/server/services/billing.service";

export interface OrganizationEntitlements {
  plan: BillingPlan;
  limits: PlanLimits;
  subscriptionActive: boolean;
}

export class PlanLimitError extends Error {
  readonly code = "PLAN_LIMIT_REACHED";

  constructor(message: string) {
    super(message);
    this.name = "PlanLimitError";
  }
}

export async function getOrganizationEntitlements(
  organizationId: string
): Promise<OrganizationEntitlements> {
  const subscription = await getOrganizationSubscription(organizationId);
  const subscriptionActive = subscription
    ? isSubscriptionActive(subscription.subscriptionStatus)
    : false;
  const plan = subscriptionActive
    ? (subscription?.plan ?? "STARTER")
    : "STARTER";

  return {
    plan,
    limits: getPlanLimits(plan),
    subscriptionActive,
  };
}

export async function getOrganizationPlan(
  organizationId: string
): Promise<BillingPlan> {
  return (await getOrganizationEntitlements(organizationId)).plan;
}

export async function assertOrganizationFeatureAccess(
  organizationId: string,
  feature: BillingFeature
): Promise<BillingPlan> {
  const entitlements = await getOrganizationEntitlements(organizationId);
  assertFeatureAccess(entitlements.plan, feature);
  return entitlements.plan;
}

export async function assertMemberCapacity(
  organizationId: string,
  additionalMembers = 1
): Promise<void> {
  const [{ limits }, memberCount, pendingInviteCount] = await Promise.all([
    getOrganizationEntitlements(organizationId),
    prisma.member.count({ where: { organizationId } }),
    prisma.invite.count({
      where: {
        organizationId,
        status: "PENDING",
        expiresAt: { gt: new Date() },
      },
    }),
  ]);

  if (
    memberCount + pendingInviteCount + additionalMembers >
    limits.maxMembers
  ) {
    throw new PlanLimitError(
      `Your current plan supports up to ${limits.maxMembers} team member${limits.maxMembers === 1 ? "" : "s"}.`
    );
  }
}

export async function getCurrentMonthlyAiTokens(
  organizationId: string,
  now = new Date()
): Promise<number> {
  const periodStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  );
  const usage = await prisma.usageRecord.aggregate({
    where: {
      organizationId,
      createdAt: { gte: periodStart },
    },
    _sum: { totalTokens: true },
  });

  return usage._sum.totalTokens ?? 0;
}

export async function assertAiTokenCapacity(
  organizationId: string,
  requestedTokens = 1
): Promise<void> {
  const [{ limits }, usedTokens] = await Promise.all([
    getOrganizationEntitlements(organizationId),
    getCurrentMonthlyAiTokens(organizationId),
  ]);

  if (usedTokens + requestedTokens > limits.monthlyAiTokens) {
    throw new PlanLimitError(
      "Your organization has reached its monthly AI usage limit."
    );
  }
}
