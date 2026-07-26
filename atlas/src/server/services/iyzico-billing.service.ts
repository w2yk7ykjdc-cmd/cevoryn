import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";
import "server-only";

import type { BillingPlan } from "@/features/billing/config/plans";
import type { SubscriptionStatus } from "@/features/billing/types";
import { prisma } from "@/lib/prisma";

export interface IyzicoSubscriptionSyncInput {
  organizationId: string;
  plan: BillingPlan;
  customerReferenceCode: string;
  subscriptionReferenceCode: string;
  pricingPlanReferenceCode: string;
  subscriptionStatus: SubscriptionStatus;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  trialEnd: Date | null;
}

export async function syncIyzicoSubscription(
  input: IyzicoSubscriptionSyncInput,
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<void> {
  await client.$executeRaw(Prisma.sql`
    INSERT INTO "subscriptions" (
      "id",
      "organization_id",
      "billing_provider",
      "iyzico_customer_reference_code",
      "iyzico_subscription_reference_code",
      "iyzico_pricing_plan_reference_code",
      "plan",
      "subscription_status",
      "current_period_start",
      "current_period_end",
      "trial_end",
      "updated_at"
    )
    VALUES (
      ${randomUUID()},
      ${input.organizationId},
      'IYZICO',
      ${input.customerReferenceCode},
      ${input.subscriptionReferenceCode},
      ${input.pricingPlanReferenceCode},
      ${input.plan}::"BillingPlan",
      ${input.subscriptionStatus}::"SubscriptionStatus",
      ${input.currentPeriodStart},
      ${input.currentPeriodEnd},
      ${input.trialEnd},
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("organization_id") DO UPDATE SET
      "billing_provider" = 'IYZICO',
      "iyzico_customer_reference_code" = EXCLUDED."iyzico_customer_reference_code",
      "iyzico_subscription_reference_code" = EXCLUDED."iyzico_subscription_reference_code",
      "iyzico_pricing_plan_reference_code" = EXCLUDED."iyzico_pricing_plan_reference_code",
      "plan" = EXCLUDED."plan",
      "subscription_status" = EXCLUDED."subscription_status",
      "current_period_start" = EXCLUDED."current_period_start",
      "current_period_end" = EXCLUDED."current_period_end",
      "trial_end" = EXCLUDED."trial_end",
      "updated_at" = CURRENT_TIMESTAMP
  `);
}

export async function updateIyzicoSubscriptionStatus(
  subscriptionReferenceCode: string,
  status: SubscriptionStatus,
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<void> {
  await client.$executeRaw(Prisma.sql`
    UPDATE "subscriptions"
    SET "subscription_status" = ${status}::"SubscriptionStatus",
        "updated_at" = CURRENT_TIMESTAMP
    WHERE "iyzico_subscription_reference_code" = ${subscriptionReferenceCode}
  `);
}

export async function runIdempotentIyzicoWebhook(
  eventId: string,
  eventType: string,
  handler: (client: Prisma.TransactionClient) => Promise<void>
): Promise<boolean> {
  return prisma.$transaction(async (transaction) => {
    const claimed = await transaction.$executeRaw(Prisma.sql`
      INSERT INTO "billing_webhook_events" ("provider", "event_id", "event_type")
      VALUES ('IYZICO', ${eventId}, ${eventType})
      ON CONFLICT ("provider", "event_id") DO NOTHING
    `);

    if (claimed === 0) return false;
    await handler(transaction);
    return true;
  });
}
