import { Prisma } from "@prisma/client";
import "server-only";

import type { BillingPlan } from "@/features/billing/config/plans";
import type {
  OrganizationSubscription,
  SubscriptionStatus,
} from "@/features/billing/types";
import { prisma } from "@/lib/prisma";

type DatabaseClient = Prisma.TransactionClient | typeof prisma;

interface SubscriptionRow {
  id: string;
  organization_id: string;
  stripe_customer_id: string;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  plan: BillingPlan;
  subscription_status: SubscriptionStatus;
  current_period_start: Date | null;
  current_period_end: Date | null;
  cancel_at_period_end: boolean;
  trial_end: Date | null;
  created_at: Date;
  updated_at: Date;
}

function mapSubscription(row: SubscriptionRow): OrganizationSubscription {
  return {
    id: row.id,
    organizationId: row.organization_id,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    stripePriceId: row.stripe_price_id,
    plan: row.plan,
    subscriptionStatus: row.subscription_status,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    trialEnd: row.trial_end,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isMissingBillingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const candidate = error as {
    code?: string;
    meta?: { code?: string; message?: string };
    message?: string;
  };

  return (
    candidate.code === "42P01" ||
    candidate.meta?.code === "42P01" ||
    candidate.meta?.message?.includes('relation "subscriptions" does not exist') === true ||
    candidate.message?.includes('relation "subscriptions" does not exist') === true
  );
}

export async function getOrganizationSubscription(
  organizationId: string,
  client: DatabaseClient = prisma
): Promise<OrganizationSubscription | null> {
  try {
    const rows = await client.$queryRaw<SubscriptionRow[]>(Prisma.sql`
      SELECT *
      FROM "subscriptions"
      WHERE "organization_id" = ${organizationId}
      LIMIT 1
    `);

    const row = rows[0];
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
