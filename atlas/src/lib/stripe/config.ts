import "server-only";

import { z } from "zod";

import type { BillingPlan } from "@/features/billing/config/plans";

const stripeEnvSchema = z.object({
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().min(1),
  STRIPE_STARTER_MONTHLY_PRICE_ID: z.string().min(1),
  STRIPE_PROFESSIONAL_MONTHLY_PRICE_ID: z.string().min(1),
  STRIPE_BUSINESS_MONTHLY_PRICE_ID: z.string().min(1),
});

export type StripeEnvironment = z.infer<typeof stripeEnvSchema>;

let cachedEnvironment: StripeEnvironment | null = null;

export class StripeConfigurationError extends Error {
  readonly code = "STRIPE_NOT_CONFIGURED";

  constructor() {
    super("Billing is temporarily unavailable.");
    this.name = "StripeConfigurationError";
  }
}

export function getStripeEnvironment(): StripeEnvironment {
  if (cachedEnvironment) return cachedEnvironment;

  const result = stripeEnvSchema.safeParse(process.env);
  if (!result.success) {
    throw new StripeConfigurationError();
  }

  cachedEnvironment = result.data;
  return cachedEnvironment;
}

export function getStripePriceId(plan: BillingPlan): string {
  const environment = getStripeEnvironment();

  const priceIds: Record<BillingPlan, string> = {
    STARTER: environment.STRIPE_STARTER_MONTHLY_PRICE_ID,
    PROFESSIONAL: environment.STRIPE_PROFESSIONAL_MONTHLY_PRICE_ID,
    BUSINESS: environment.STRIPE_BUSINESS_MONTHLY_PRICE_ID,
  };

  return priceIds[plan];
}

export function getPlanForStripePriceId(priceId: string): BillingPlan | null {
  const environment = getStripeEnvironment();

  const planByPriceId = new Map<string, BillingPlan>([
    [environment.STRIPE_STARTER_MONTHLY_PRICE_ID, "STARTER"],
    [environment.STRIPE_PROFESSIONAL_MONTHLY_PRICE_ID, "PROFESSIONAL"],
    [environment.STRIPE_BUSINESS_MONTHLY_PRICE_ID, "BUSINESS"],
  ]);

  return planByPriceId.get(priceId) ?? null;
}
