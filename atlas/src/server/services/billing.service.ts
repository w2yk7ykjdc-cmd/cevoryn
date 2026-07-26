import { randomUUID } from "node:crypto";

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

export interface SubscriptionSyncInput {
  organizationId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  plan: BillingPlan;
  subscriptionStatus: SubscriptionStatus;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  trialEnd: Date | null;
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

export async function getSubscriptionByStripeCustomerId(
  stripeCustomerId: string,
  client: DatabaseClient = prisma
): Promise<OrganizationSubscription | null> {
  try {
    const rows = await client.$queryRaw<SubscriptionRow[]>(Prisma.sql`
      SELECT *
      FROM "subscriptions"
      WHERE "stripe_customer_id" = ${stripeCustomerId}
      LIMIT 1
    `);

    const row = rows[0];
    return row ? mapSubscription(row) : null;
  } catch (error) {
    if (isMissingBillingTableError(error)) return null;
    throw error;
  }
}

export async function ensureStripeCustomerRecord(
  organizationId: string,
  stripeCustomerId: string,
  plan: BillingPlan,
  client: DatabaseClient = prisma
): Promise<OrganizationSubscription> {
  const rows = await client.$queryRaw<SubscriptionRow[]>(Prisma.sql`
    INSERT INTO "subscriptions" (
      "id",
      "organization_id",
      "stripe_customer_id",
      "plan",
      "subscription_status",
      "updated_at"
    )
    VALUES (
      ${randomUUID()},
      ${organizationId},
      ${stripeCustomerId},
      ${plan}::"BillingPlan",
      'INCOMPLETE'::"SubscriptionStatus",
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("organization_id") DO UPDATE SET
      "stripe_customer_id" = EXCLUDED."stripe_customer_id",
      "plan" = EXCLUDED."plan",
      "updated_at" = CURRENT_TIMESTAMP
    RETURNING *
  `);

  const row = rows[0];
  if (!row) throw new Error("Failed to persist Stripe customer.");
  return mapSubscription(row);
}

export async function syncOrganizationSubscription(
  input: SubscriptionSyncInput,
  client: DatabaseClient = prisma
): Promise<OrganizationSubscription> {
  const rows = await client.$queryRaw<SubscriptionRow[]>(Prisma.sql`
    INSERT INTO "subscriptions" (
      "id",
      "organization_id",
      "stripe_customer_id",
      "stripe_subscription_id",
      "stripe_price_id",
      "plan",
      "subscription_status",
      "current_period_start",
      "current_period_end",
      "cancel_at_period_end",
      "trial_end",
      "updated_at"
    )
    VALUES (
      ${randomUUID()},
      ${input.organizationId},
      ${input.stripeCustomerId},
      ${input.stripeSubscriptionId},
      ${input.stripePriceId},
      ${input.plan}::"BillingPlan",
      ${input.subscriptionStatus}::"SubscriptionStatus",
      ${input.currentPeriodStart},
      ${input.currentPeriodEnd},
      ${input.cancelAtPeriodEnd},
      ${input.trialEnd},
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("organization_id") DO UPDATE SET
      "stripe_customer_id" = EXCLUDED."stripe_customer_id",
      "stripe_subscription_id" = EXCLUDED."stripe_subscription_id",
      "stripe_price_id" = EXCLUDED."stripe_price_id",
      "plan" = EXCLUDED."plan",
      "subscription_status" = EXCLUDED."subscription_status",
      "current_period_start" = EXCLUDED."current_period_start",
      "current_period_end" = EXCLUDED."current_period_end",
      "cancel_at_period_end" = EXCLUDED."cancel_at_period_end",
      "trial_end" = EXCLUDED."trial_end",
      "updated_at" = CURRENT_TIMESTAMP
    RETURNING *
  `);

  const row = rows[0];
  if (!row) throw new Error("Failed to synchronize subscription.");
  return mapSubscription(row);
}

export async function runIdempotentWebhookEvent(
  eventId: string,
  eventType: string,
  handler: (client: Prisma.TransactionClient) => Promise<void>
): Promise<boolean> {
  return prisma.$transaction(async (transaction) => {
    const claimed = await transaction.$executeRaw(Prisma.sql`
      INSERT INTO "stripe_webhook_events" (
        "stripe_event_id",
        "event_type"
      )
      VALUES (${eventId}, ${eventType})
      ON CONFLICT ("stripe_event_id") DO NOTHING
    `);

    if (claimed === 0) return false;

    await handler(transaction);
    return true;
  });
}
