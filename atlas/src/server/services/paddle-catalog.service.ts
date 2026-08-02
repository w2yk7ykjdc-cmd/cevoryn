import "server-only";

import {
  BILLING_PLANS,
  type BillingPlan,
} from "@/features/billing/config/plans";
import { getPaddlePriceId, paddleApi } from "@/lib/paddle/config";

export interface PlanPrice {
  amount: number;
  currencyCode: string;
  interval: "day" | "week" | "month" | "year";
}

interface PaddlePriceResponse {
  data: {
    unit_price: { amount: string; currency_code: string };
    billing_cycle: {
      interval: "day" | "week" | "month" | "year";
      frequency: number;
    } | null;
  };
}

export async function getPlanPrices(): Promise<
  Partial<Record<BillingPlan, PlanPrice>>
> {
  const entries = await Promise.all(
    BILLING_PLANS.map(
      async (plan): Promise<[BillingPlan, PlanPrice | null]> => {
        try {
          const priceId = getPaddlePriceId(plan);
          const response = await paddleApi<PaddlePriceResponse>(
            `/prices/${priceId}`
          );
          const { unit_price, billing_cycle } = response.data;

          return [
            plan,
            {
              amount: Number(unit_price.amount) / 100,
              currencyCode: unit_price.currency_code,
              interval: billing_cycle?.interval ?? "month",
            },
          ];
        } catch (error) {
          console.error("[cevoryn:billing] Failed to load Paddle price", {
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
