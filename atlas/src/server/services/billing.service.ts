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
