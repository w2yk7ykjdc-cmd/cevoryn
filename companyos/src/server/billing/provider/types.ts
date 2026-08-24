export type CheckoutSessionInput = {
  organizationId: string;
  /** Existing Stripe customer id, if this organization already has one. */
  customerId?: string;
  /** Used to pre-fill the checkout email when there's no customer id yet. */
  customerEmail?: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
};

export type CheckoutSessionResult = { url: string };

export type BillingPortalSessionInput = {
  customerId: string;
  returnUrl: string;
};

export type BillingPortalSessionResult = { url: string };

/** Mirrors Stripe's own event envelope shape so the real adapter needs no translation. */
export type WebhookEvent = {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
};

export interface PaymentProvider {
  readonly id: "stripe";
  createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult>;
  createBillingPortalSession(input: BillingPortalSessionInput): Promise<BillingPortalSessionResult>;
  /** Verifies the webhook signature and parses the raw body. Throws `PaymentProviderError` on an invalid signature. */
  constructWebhookEvent(rawBody: string, signature: string): WebhookEvent;
  cancelSubscription(stripeSubscriptionId: string): Promise<void>;
}

export class PaymentProviderError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "PaymentProviderError";
  }
}
