import { Prisma } from "@prisma/client";
import "server-only";

import type { SubscriptionStatus } from "@/features/billing/types";

export async function updateSubscriptionStatusByCustomerId(
  client: Prisma.TransactionClient,
  stripeCustomerId: string,
  status: SubscriptionStatus
): Promise<void> {
  await client.$executeRaw(Prisma.sql`
    UPDATE "subscriptions"
    SET
      "subscription_status" = ${status}::"SubscriptionStatus",
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "stripe_customer_id" = ${stripeCustomerId}
  `);
}
