import type { OrganizationSubscription } from "./types";

/**
 * The Paddle webhook handler (src/app/api/billing/paddle/webhook/route.ts) is
 * the only code path that writes to "subscriptions", and it always stores
 * `paddle:${paddleCustomerId}` in the legacy stripe_customer_id column
 * (repurposed because it's NOT NULL + UNIQUE from the pre-Paddle schema). A
 * row that doesn't follow that convention did not come from the current
 * billing code — e.g. leftover Stripe-era data or a manual DB edit.
 */
export const PADDLE_CUSTOMER_ID_PREFIX = "paddle:";

export interface SubscriptionIntegrityFindings {
  originatedFromPaddleWebhook: boolean;
  anomalies: string[];
}

/** Pure — no I/O, safe to unit test without a database. */
export function evaluateSubscriptionIntegrity(
  subscription: OrganizationSubscription
): SubscriptionIntegrityFindings {
  const originatedFromPaddleWebhook = subscription.stripeCustomerId.startsWith(
    PADDLE_CUSTOMER_ID_PREFIX
  );

  const anomalies: string[] = [];

  if (!originatedFromPaddleWebhook) {
    anomalies.push(
      `stripe_customer_id ("${subscription.stripeCustomerId}") does not match the "${PADDLE_CUSTOMER_ID_PREFIX}<id>" convention the Paddle webhook always writes — this row may predate the Paddle migration or was not created by the current billing code path.`
    );
  }

  const isActiveStatus =
    subscription.subscriptionStatus === "ACTIVE" ||
    subscription.subscriptionStatus === "TRIALING";

  if (isActiveStatus && !subscription.paddleSubscriptionId) {
    anomalies.push(
      `subscription_status is "${subscription.subscriptionStatus}" but paddle_subscription_id is null.`
    );
  }

  if (isActiveStatus && !subscription.paddleCustomerId) {
    anomalies.push(
      `subscription_status is "${subscription.subscriptionStatus}" but paddle_customer_id is null.`
    );
  }

  return { originatedFromPaddleWebhook, anomalies };
}
