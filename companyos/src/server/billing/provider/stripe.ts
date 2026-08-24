import Stripe from "stripe";
import type {
  BillingPortalSessionInput,
  BillingPortalSessionResult,
  CheckoutSessionInput,
  CheckoutSessionResult,
  PaymentProvider,
  WebhookEvent,
} from "@/server/billing/provider/types";
import { PaymentProviderError } from "@/server/billing/provider/types";

export function createStripeProvider(secretKey: string, webhookSecret: string | undefined): PaymentProvider {
  const stripe = new Stripe(secretKey);

  return {
    id: "stripe",

    async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult> {
      try {
        const session = await stripe.checkout.sessions.create({
          mode: "subscription",
          line_items: [{ price: input.priceId, quantity: 1 }],
          customer: input.customerId,
          customer_email: input.customerId ? undefined : input.customerEmail,
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          client_reference_id: input.organizationId,
          subscription_data: { metadata: { organizationId: input.organizationId } },
        });
        if (!session.url) {
          throw new PaymentProviderError("Stripe did not return a checkout URL");
        }
        return { url: session.url };
      } catch (err) {
        if (err instanceof PaymentProviderError) throw err;
        throw new PaymentProviderError("Failed to create checkout session", err);
      }
    },

    async createBillingPortalSession(input: BillingPortalSessionInput): Promise<BillingPortalSessionResult> {
      try {
        const session = await stripe.billingPortal.sessions.create({
          customer: input.customerId,
          return_url: input.returnUrl,
        });
        return { url: session.url };
      } catch (err) {
        throw new PaymentProviderError("Failed to create billing portal session", err);
      }
    },

    constructWebhookEvent(rawBody: string, signature: string): WebhookEvent {
      if (!webhookSecret) {
        throw new PaymentProviderError("STRIPE_WEBHOOK_SECRET is not configured");
      }
      try {
        const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
        return {
          id: event.id,
          type: event.type,
          data: event.data as unknown as { object: Record<string, unknown> },
        };
      } catch (err) {
        throw new PaymentProviderError("Invalid webhook signature", err);
      }
    },

    async cancelSubscription(stripeSubscriptionId: string): Promise<void> {
      try {
        await stripe.subscriptions.cancel(stripeSubscriptionId);
      } catch (err) {
        throw new PaymentProviderError("Failed to cancel subscription", err);
      }
    },
  };
}
