import { Prisma, type Subscription } from "@prisma/client";
import "server-only";

import { evaluateSubscriptionIntegrity } from "@/features/billing/subscription-integrity";
import type { OrganizationSubscription } from "@/features/billing/types";
import {
  getBillingPlanFromPolarProductId,
  mapPolarSubscriptionStatus,
  parseDate,
  type PolarSubscriptionEvent,
} from "@/lib/polar/mapping";
import { prisma } from "@/lib/prisma";
import { isMissingBillingTableError } from "@/server/services/billing-errors";

type DatabaseClient = Prisma.TransactionClient | typeof prisma;

function mapSubscription(row: Subscription): OrganizationSubscription {
  return {
    id: row.id,
    organizationId: row.organizationId,
    stripeCustomerId: row.stripeCustomerId,
    stripeSubscriptionId: row.stripeSubscriptionId,
    stripePriceId: row.stripePriceId,
    paddleCustomerId: row.paddleCustomerId,
    paddleSubscriptionId: row.paddleSubscriptionId,
    paddlePriceId: row.paddlePriceId,
    polarCustomerId: row.polarCustomerId,
    polarSubscriptionId: row.polarSubscriptionId,
    polarProductId: row.polarProductId,
    plan: row.plan,
    subscriptionStatus: row.subscriptionStatus,
    currentPeriodStart: row.currentPeriodStart,
    currentPeriodEnd: row.currentPeriodEnd,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    trialEnd: row.trialEnd,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getOrganizationSubscription(
  organizationId: string,
  client: DatabaseClient = prisma
): Promise<OrganizationSubscription | null> {
  try {
    const row = await client.subscription.findUnique({
      where: { organizationId },
    });

    return row ? mapSubscription(row) : null;
  } catch (error) {
    if (isMissingBillingTableError(error)) {
      console.warn(
        "[cevoryn:billing] Subscription migration is not applied; using Starter entitlements."
      );
      return null;
    }

    throw error;
  }
}

export interface ApplyPolarEventResult {
  /** false when this event_id was already claimed by an earlier delivery. */
  processed: boolean;
  /** false when processed but skipped as an out-of-order/stale event. */
  applied: boolean;
}

/**
 * Idempotently records a Polar subscription webhook event and, if it's the
 * newest one seen for this subscription, upserts the organization's
 * subscription row. The caller (the webhook route) is only responsible for
 * signature verification and event-type filtering before calling this.
 */
export async function applyPolarSubscriptionEvent(
  eventId: string,
  event: PolarSubscriptionEvent
): Promise<ApplyPolarEventResult> {
  return prisma.$transaction(async (transaction) => {
    const claimed = await transaction.$executeRaw(Prisma.sql`
      INSERT INTO "billing_webhook_events" ("provider", "event_id", "event_type")
      VALUES ('polar', ${eventId}, ${event.type})
      ON CONFLICT ("provider", "event_id") DO NOTHING
    `);
    if (claimed === 0) return { processed: false, applied: false };

    const organizationId = event.data.metadata?.organizationId;
    const productId = event.data.product_id;
    const plan = productId ? getBillingPlanFromPolarProductId(productId) : null;

    if (
      typeof organizationId !== "string" ||
      !event.data.id ||
      !event.data.customer_id ||
      !productId ||
      !plan
    ) {
      throw new Error(
        "Polar subscription event is missing CEVORYN metadata or references an unknown product."
      );
    }

    const eventTimestamp = parseDate(event.timestamp);

    // Guards against out-of-order webhook delivery: Polar (like any
    // webhook provider) does not guarantee events arrive in the order
    // they occurred - a retried/delayed OLDER event can arrive after a
    // NEWER event already updated this row. The WHERE clause below keeps
    // this a single atomic statement (no separate SELECT, no race
    // between check and write) and only blocks the update when we have
    // positive evidence the incoming event is older than what's already
    // stored; it never blocks when either side lacks a timestamp to
    // compare, so a real update is never silently dropped just because
    // Polar omitted a timestamp.
    const updateResult = await transaction.$executeRaw(Prisma.sql`
      INSERT INTO "subscriptions" (
        "id", "organization_id", "stripe_customer_id", "plan", "subscription_status",
        "polar_customer_id", "polar_subscription_id", "polar_product_id",
        "current_period_start", "current_period_end", "cancel_at_period_end",
        "last_webhook_event_at", "updated_at"
      ) VALUES (
        ${crypto.randomUUID()}, ${organizationId}, ${`polar:${event.data.customer_id}`},
        ${plan}::"BillingPlan", ${mapPolarSubscriptionStatus(event.data.status)}::"SubscriptionStatus",
        ${event.data.customer_id}, ${event.data.id}, ${productId},
        ${parseDate(event.data.current_period_start)},
        ${parseDate(event.data.current_period_end)},
        ${event.data.cancel_at_period_end === true},
        ${eventTimestamp}, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("organization_id") DO UPDATE SET
        "plan" = EXCLUDED."plan",
        "subscription_status" = EXCLUDED."subscription_status",
        "polar_customer_id" = EXCLUDED."polar_customer_id",
        "polar_subscription_id" = EXCLUDED."polar_subscription_id",
        "polar_product_id" = EXCLUDED."polar_product_id",
        "current_period_start" = EXCLUDED."current_period_start",
        "current_period_end" = EXCLUDED."current_period_end",
        "cancel_at_period_end" = EXCLUDED."cancel_at_period_end",
        "last_webhook_event_at" = EXCLUDED."last_webhook_event_at",
        "updated_at" = CURRENT_TIMESTAMP
      WHERE
        "subscriptions"."last_webhook_event_at" IS NULL
        OR EXCLUDED."last_webhook_event_at" IS NULL
        OR EXCLUDED."last_webhook_event_at" >= "subscriptions"."last_webhook_event_at"
    `);

    return { processed: true, applied: updateResult > 0 };
  });
}

export interface SubscriptionIntegrityReport {
  organizationId: string;
  subscription: OrganizationSubscription | null;
  /** null when there is no subscription row to evaluate. */
  originatedFromPaddleWebhook: boolean | null;
  /** null when there is no subscription row to evaluate. */
  originatedFromPolarWebhook: boolean | null;
  anomalies: string[];
  /** Historical; Paddle is no longer an active billing provider. */
  totalPaddleWebhookEventsProcessed: number;
  totalPolarWebhookEventsProcessed: number;
}

export async function getSubscriptionIntegrityReport(
  organizationId: string
): Promise<SubscriptionIntegrityReport> {
  const [
    subscription,
    totalPaddleWebhookEventsProcessed,
    totalPolarWebhookEventsProcessed,
  ] = await Promise.all([
    getOrganizationSubscription(organizationId),
    prisma.billingWebhookEvent
      .count({ where: { provider: "paddle" } })
      .catch((error) => {
        if (isMissingBillingTableError(error)) return 0;
        throw error;
      }),
    prisma.billingWebhookEvent
      .count({ where: { provider: "polar" } })
      .catch((error) => {
        if (isMissingBillingTableError(error)) return 0;
        throw error;
      }),
  ]);

  if (!subscription) {
    return {
      organizationId,
      subscription: null,
      originatedFromPaddleWebhook: null,
      originatedFromPolarWebhook: null,
      anomalies: [],
      totalPaddleWebhookEventsProcessed,
      totalPolarWebhookEventsProcessed,
    };
  }

  const findings = evaluateSubscriptionIntegrity(subscription);

  return {
    organizationId,
    subscription,
    ...findings,
    totalPaddleWebhookEventsProcessed,
    totalPolarWebhookEventsProcessed,
  };
}

/**
 * Deletes billing_webhook_events rows older than `olderThanDays` - this
 * table exists purely so the webhook route's `ON CONFLICT (provider,
 * event_id) DO NOTHING` can recognize and ignore a redelivered event; a row
 * only needs to survive as long as the provider might still redeliver it.
 *
 * Polar does not publish an exact redelivery *window* (a "retries stop
 * after N days" number). What is documented/observed: failed deliveries are
 * retried with exponential backoff for a period measured in hours (not
 * days), an endpoint is auto-disabled after 10 consecutive failures, and
 * there is no dead-letter queue - once Polar gives up on an event, it is
 * gone for good, not replayed later. So the real redelivery window this
 * table needs to survive is short (hours). 30 days is kept anyway as a
 * deliberately oversized margin: this table is small/low-volume, so the
 * cost of retaining rows far longer than necessary is negligible, while
 * the cost of deleting one too early is a real correctness bug (a late
 * legitimate retry gets reprocessed as if it were new).
 */
export async function cleanupStaleBillingWebhookEvents(
  olderThanDays = 30
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  return prisma.$executeRaw`
    DELETE FROM "billing_webhook_events" WHERE "created_at" < ${cutoff}
  `;
}
