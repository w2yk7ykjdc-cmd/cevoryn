import type {
  BillingPortalSessionInput,
  BillingPortalSessionResult,
  CheckoutSessionInput,
  CheckoutSessionResult,
  PaymentProvider,
} from "@/server/billing/provider/types";

/**
 * A deterministic `PaymentProvider` test double, mirroring the fake
 * `AIProvider` pattern used for the planner/agent tests — Stripe is a
 * genuinely external, non-deterministic-to-test service, so the billing
 * business logic (subscription/usage) is tested against this interface
 * substitute rather than mocking internals.
 */
export function createFakePaymentProvider(overrides?: Partial<PaymentProvider>): PaymentProvider {
  return {
    id: "stripe",
    createCheckoutSession:
      overrides?.createCheckoutSession ??
      (async (input: CheckoutSessionInput): Promise<CheckoutSessionResult> => ({
        url: `https://checkout.stripe.test/session?org=${input.organizationId}&price=${input.priceId}`,
      })),
    createBillingPortalSession:
      overrides?.createBillingPortalSession ??
      (async (input: BillingPortalSessionInput): Promise<BillingPortalSessionResult> => ({
        url: `https://billing.stripe.test/portal?customer=${input.customerId}`,
      })),
    constructWebhookEvent:
      overrides?.constructWebhookEvent ??
      (() => {
        throw new Error(
          "constructWebhookEvent is not exercised through the fake provider — tests call applyWebhookEvent directly with a hand-built WebhookEvent.",
        );
      }),
    cancelSubscription: overrides?.cancelSubscription ?? (async () => {}),
  };
}
