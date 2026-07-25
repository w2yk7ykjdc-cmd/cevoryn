import "server-only";

import Stripe from "stripe";

import { getStripeEnvironment } from "@/lib/stripe/config";

let stripeClient: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (stripeClient) return stripeClient;

  stripeClient = new Stripe(getStripeEnvironment().STRIPE_SECRET_KEY, {
    appInfo: {
      name: "CEVORYN",
      version: "1.0.0-rc.3",
    },
    typescript: true,
  });

  return stripeClient;
}
