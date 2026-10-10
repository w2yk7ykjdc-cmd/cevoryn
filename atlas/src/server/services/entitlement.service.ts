import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";
import "server-only";

import {
  assertFeatureAccess,
  getPlanLimits,
  type BillingFeature,
  type BillingPlan,
  type PlanLimits,
} from "@/features/billing/config/plans";
import { isSubscriptionActive } from "@/features/billing/types";
import { AI_CONFIG } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { getOrganizationSubscription } from "@/server/services/billing.service";
import type { TokenUsage } from "@/types";

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

/**
 * Serialize capacity-sensitive member/invite writes per organization.
 *
 * The plan check and the write must share this transaction; checking capacity
 * before a separate create/accept operation allows concurrent requests to
 * exceed the configured member limit.
 */
export async function withMemberCapacityLock<T>(
  organizationId: string,
  additionalMembers: number,
  operation: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  const { limits } = await getOrganizationEntitlements(organizationId);

  return prisma.$transaction(async (tx) => {
    // Use a dedicated namespace so this lock cannot collide with other
    // advisory-lock users that hash the raw organization ID.
    await tx.$queryRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`member-capacity:${organizationId}`}, 0)
      ) IS NULL AS lock_acquired
    `);

    const [memberCount, pendingInviteCount] = await Promise.all([
      tx.member.count({ where: { organizationId } }),
      tx.invite.count({
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

    return operation(tx);
  });
}

/** Read-only capacity assertion retained for callers that only need a check. */
export async function assertMemberCapacity(
  organizationId: string,
  additionalMembers = 1
): Promise<void> {
  await withMemberCapacityLock(
    organizationId,
    additionalMembers,
    async () => {}
  );
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

/**
 * Atomically check-and-reserve AI token capacity for the chat route, which
 * streams for several seconds before actual usage is known. `assertAiTokenCapacity`
 * alone has a check-then-act race: two concurrent requests can both read the
 * same pre-increment usage and both pass, since neither's usage is recorded
 * until well after the check. This closes that gap by inserting a
 * placeholder UsageRecord for `estimatedTokens` as part of the same
 * transaction that re-checks every cap, serialized per-organization via a
 * transaction-scoped Postgres advisory lock (held only for this one
 * transaction, not across the AI call).
 *
 * Three caps are enforced here, all under the same lock: the plan's
 * monthly org-wide limit, and the daily org-wide and daily per-user limits
 * (AI_CONFIG.dailyTokenLimitPerOrg/PerUser) that used to be checked
 * separately and non-atomically via rate-limit.service.ts's
 * checkRateLimit — called redundantly once in the chat route and again in
 * ai.service.ts's sendMessage, with a check-then-act race identical to the
 * one this function was originally written to close for the monthly cap.
 * Folding them in here closes that race the same way and removes the
 * redundant second call (ai.service.ts no longer calls checkRateLimit at
 * all; by the time sendMessage runs, this reservation has already proven
 * every cap was satisfied).
 *
 * On success, call `reconcileAiTokenReservation` with the real usage once
 * the AI call completes. On failure, call `releaseAiTokenReservation` so
 * the estimate doesn't permanently eat into the org's remaining budget.
 */
export async function reserveAiTokenCapacity(params: {
  organizationId: string;
  userId: string;
  conversationId: string;
  model: string;
  estimatedTokens: number;
}): Promise<string> {
  const { limits } = await getOrganizationEntitlements(params.organizationId);
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const reservationId = randomUUID();

  // Keep stale placeholders from consuming quota for up to a full cron
  // interval. The scheduled sweep remains a backstop, but every new
  // reservation also cleans this organization's expired placeholders while
  // holding the same advisory lock used for the capacity check.
  const staleReservationCutoff = new Date(Date.now() - 60 * 60 * 1000);

  // Returned (not thrown) from inside the transaction so the stale-cleanup
  // DELETE above still commits even when the reservation itself is
  // rejected - throwing here would roll that cleanup back too.
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtext(${params.organizationId})) IS NULL AS lock_acquired
    `);

    await tx.$executeRaw`
      DELETE FROM "usage_records"
      WHERE "organization_id" = ${params.organizationId}
        AND "input_tokens" = 0
        AND "output_tokens" = 0
        AND "total_tokens" > 0
        AND "created_at" < ${staleReservationCutoff}
    `;

    const [monthlyUsage, dailyOrgUsage, dailyUserUsage] = await Promise.all([
      tx.usageRecord.aggregate({
        where: {
          organizationId: params.organizationId,
          createdAt: { gte: monthStart },
        },
        _sum: { totalTokens: true },
      }),
      tx.usageRecord.aggregate({
        where: {
          organizationId: params.organizationId,
          createdAt: { gte: dayStart },
        },
        _sum: { totalTokens: true },
      }),
      tx.usageRecord.aggregate({
        where: {
          organizationId: params.organizationId,
          userId: params.userId,
          createdAt: { gte: dayStart },
        },
        _sum: { totalTokens: true },
      }),
    ]);

    const monthlyUsed = monthlyUsage._sum.totalTokens ?? 0;
    const dailyOrgUsed = dailyOrgUsage._sum.totalTokens ?? 0;
    const dailyUserUsed = dailyUserUsage._sum.totalTokens ?? 0;
    const estimated = params.estimatedTokens;

    if (monthlyUsed + estimated > limits.monthlyAiTokens) {
      return { ok: false as const, reason: "monthly" as const };
    }
    if (dailyOrgUsed + estimated > AI_CONFIG.dailyTokenLimitPerOrg) {
      return { ok: false as const, reason: "daily_org" as const };
    }
    if (dailyUserUsed + estimated > AI_CONFIG.dailyTokenLimitPerUser) {
      return { ok: false as const, reason: "daily_user" as const };
    }

    await tx.usageRecord.create({
      data: {
        id: reservationId,
        organizationId: params.organizationId,
        userId: params.userId,
        conversationId: params.conversationId,
        model: params.model,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: estimated,
      },
    });

    return { ok: true as const };
  });

  if (!result.ok) {
    if (result.reason === "monthly") {
      throw new PlanLimitError(
        "Your organization has reached its monthly AI usage limit."
      );
    }
    if (result.reason === "daily_org") {
      throw new PlanLimitError(
        `Daily token limit reached (${AI_CONFIG.dailyTokenLimitPerOrg.toLocaleString()} tokens). Resets at midnight.`
      );
    }
    throw new PlanLimitError(
      `You've reached your personal daily AI usage limit (${AI_CONFIG.dailyTokenLimitPerUser.toLocaleString()} tokens). Resets at midnight.`
    );
  }

  return reservationId;
}

/** Replace a reservation's estimated tokens with the AI call's real usage. */
export async function reconcileAiTokenReservation(
  reservationId: string,
  usage: TokenUsage
): Promise<void> {
  await prisma.usageRecord.update({
    where: { id: reservationId },
    data: {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
    },
  });
}

/**
 * Undo a reservation that never turned into real usage (the AI call failed).
 * Only deletes if the row is still an untouched placeholder (zero tokens) —
 * if it was already reconciled with real usage, this is a safe no-op rather
 * than a way to accidentally delete confirmed usage data.
 */
export async function releaseAiTokenReservation(
  reservationId: string
): Promise<void> {
  await prisma.$executeRaw`
    DELETE FROM "usage_records"
    WHERE "id" = ${reservationId}
      AND "input_tokens" = 0
      AND "output_tokens" = 0
  `;
}

/**
 * Sweep up reservations that were never reconciled or released — the one
 * disclosed gap in the reserve/reconcile/release flow above: if the
 * serverless function is killed (e.g. its maxDuration timeout) between
 * reserving and reconciling, no cleanup code runs and the placeholder is
 * left behind, permanently reducing the org's remaining budget by the
 * estimate. Run on a schedule (see /api/cron/cleanup-usage-reservations)
 * so that reduction is temporary, not permanent. Only ever touches rows
 * still holding placeholder (zero) token values, so a reservation that
 * completed normally moments before this runs is never at risk.
 */
export async function cleanupStaleAiTokenReservations(
  olderThanMinutes = 60
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);
  return prisma.$executeRaw`
    DELETE FROM "usage_records"
    WHERE "input_tokens" = 0
      AND "output_tokens" = 0
      AND "total_tokens" > 0
      AND "created_at" < ${cutoff}
  `;
}
