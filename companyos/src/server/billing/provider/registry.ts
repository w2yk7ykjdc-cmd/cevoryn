import { env } from "@/env";
import type { PaymentProvider } from "@/server/billing/provider/types";
import { createStripeProvider } from "@/server/billing/provider/stripe";

let instance: PaymentProvider | undefined;

/** Lazily constructs and caches the Stripe-backed provider. Throws if unconfigured. */
export function getPaymentProvider(): PaymentProvider {
  if (instance) return instance;
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  instance = createStripeProvider(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET);
  return instance;
}

/** Whether checkout/portal/webhook flows can run at all in this environment. */
export function isBillingConfigured(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY);
}

/**
 * Whether inbound Stripe webhooks can be verified. Checked separately from
 * `isBillingConfigured()`: a deployment can have `STRIPE_SECRET_KEY` set
 * (checkout/portal work fine) while `STRIPE_WEBHOOK_SECRET` is missing —
 * that combination must fail loudly at the webhook route rather than
 * quietly rejecting every event as an "invalid signature".
 */
export function isWebhookVerificationConfigured(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY) && Boolean(env.STRIPE_WEBHOOK_SECRET);
}
