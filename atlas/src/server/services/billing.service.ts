import type { Prisma, Subscription } from "@prisma/client";
import "server-only";

import { evaluateSubscriptionIntegrity } from "@/features/billing/subscription-integrity";
import type { OrganizationSubscription } from "@/features/billing/types";
import { prisma } from "@/lib/prisma";

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

function isMissingBillingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const candidate = error as {
    code?: string;
    meta?: { code?: string; message?: string; modelName?: string };
    message?: string;
  };

  return (
    // Raised by Prisma's generated client (e.g. .findUnique()) when the
    // underlying table is missing.
    candidate.code === "P2021" ||
    // Raised by $queryRaw against a bare Postgres connection.
    candidate.code === "42P01" ||
    candidate.meta?.code === "42P01" ||
    candidate.meta?.message?.includes(
      'relation "subscriptions" does not exist'
    ) === true ||
    candidate.message?.includes('relation "subscriptions" does not exist') ===
      true ||
    candidate.message?.includes("does not exist in the current database") ===
      true
  );
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
  anomalies: string[];
  totalPaddleWebhookEventsProcessed: number;
}

export async function getSubscriptionIntegrityReport(
  organizationId: string
): Promise<SubscriptionIntegrityReport> {
  const [subscription, totalPaddleWebhookEventsProcessed] = await Promise.all([
    getOrganizationSubscription(organizationId),
    prisma.billingWebhookEvent
      .count({ where: { provider: "paddle" } })
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
      anomalies: [],
      totalPaddleWebhookEventsProcessed,
    };
  }

  const findings = evaluateSubscriptionIntegrity(subscription);

  return {
    organizationId,
    subscription,
    ...findings,
    totalPaddleWebhookEventsProcessed,
  };
}
