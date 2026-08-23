import type { Prisma, Subscription } from "@prisma/client";
import "server-only";

import { evaluateSubscriptionIntegrity } from "@/features/billing/subscription-integrity";
import type { OrganizationSubscription } from "@/features/billing/types";
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
