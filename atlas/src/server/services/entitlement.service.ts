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

/**
 * Atomically check-and-reserve AI token capacity for the chat route, which
 * streams for several seconds before actual usage is known. `assertAiTokenCapacity`
 * alone has a check-then-act race: two concurrent requests can both read the
 * same pre-increment usage and both pass, since neither's usage is recorded
 * until well after the check. This closes that gap by inserting a
 * placeholder UsageRecord for `estimatedTokens` as part of the same
 * statement that re-checks the cap, serialized per-organization via a
 * transaction-scoped Postgres advisory lock (held only for this one
 * statement, not across the AI call).
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
  const periodStart = new Date();
  periodStart.setUTCDate(1);
  periodStart.setUTCHours(0, 0, 0, 0);
  const reservationId = randomUUID();

  const inserted = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    WITH lock_org AS (
      SELECT pg_advisory_xact_lock(hashtext(${params.organizationId}))
    ),
    current_usage AS (
      SELECT COALESCE(SUM("total_tokens"), 0) AS used
      FROM "usage_records"
      WHERE "organization_id" = ${params.organizationId}
        AND "created_at" >= ${periodStart}
    )
    INSERT INTO "usage_records" (
      "id", "organization_id", "user_id", "conversation_id", "model",
      "input_tokens", "output_tokens", "total_tokens"
    )
    SELECT ${reservationId}, ${params.organizationId}, ${params.userId},
      ${params.conversationId}, ${params.model}, 0, 0, ${params.estimatedTokens}
    FROM current_usage, lock_org
    WHERE current_usage.used + ${params.estimatedTokens} <= ${limits.monthlyAiTokens}
    RETURNING "id"
  `);

  if (inserted.length === 0) {
    throw new PlanLimitError(
      "Your organization has reached its monthly AI usage limit."
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
