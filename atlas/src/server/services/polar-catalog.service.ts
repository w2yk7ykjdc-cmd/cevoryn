import "server-only";

import {
  BILLING_PLANS,
  type BillingPlan,
} from "@/features/billing/config/plans";
import { getPolarProductId, polarApi } from "@/lib/polar/config";

export interface PlanPrice {
  amount: number;
  currencyCode: string;
  interval: "day" | "week" | "month" | "year";
}

interface PolarProductResponse {
  recurring_interval: "month" | "year" | null;
  prices: Array<{
    amount_type: string;
    price_amount?: number;
    price_currency?: string;
    is_archived: boolean;
  }>;
}

export async function getPlanPrices(): Promise<
  Partial<Record<BillingPlan, PlanPrice>>
> {
  const entries = await Promise.all(
    BILLING_PLANS.map(
      async (plan): Promise<[BillingPlan, PlanPrice | null]> => {
        try {
          const productId = getPolarProductId(plan);
          const response = await polarApi<PolarProductResponse>(
            `/v1/products/${productId}`
          );
          const price = response.prices.find(
            (candidate) =>
              candidate.amount_type === "fixed" && !candidate.is_archived
          );
          if (!price?.price_amount || !price.price_currency) {
            return [plan, null];
          }

          return [
            plan,
            {
              amount: price.price_amount / 100,
              currencyCode: price.price_currency,
              interval: response.recurring_interval ?? "month",
            },
          ];
        } catch (error) {
          console.error("[cevoryn:billing] Failed to load Polar price", {
            plan,
            message: error instanceof Error ? error.message : "Unknown error",
          });
          return [plan, null];
        }
      }
    )
  );

  return Object.fromEntries(
    entries.filter(
      (entry): entry is [BillingPlan, PlanPrice] => entry[1] !== null
    )
  );
}
