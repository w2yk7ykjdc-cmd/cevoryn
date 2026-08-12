import type { OrganizationSubscription } from "./types";

/**
 * The Paddle and Polar webhook handlers
 * (src/app/api/billing/{paddle,polar}/webhook/route.ts) are the only code
 * paths that write to "subscriptions", and each always stores
 * `<provider>:<providerCustomerId>` in the legacy stripe_customer_id column
 * (repurposed because it's NOT NULL + UNIQUE from the pre-Paddle schema). A
 * row that doesn't follow that convention did not come from either current
 * billing code path — e.g. leftover Stripe-era data or a manual DB edit.
 */
export const PADDLE_CUSTOMER_ID_PREFIX = "paddle:";
export const POLAR_CUSTOMER_ID_PREFIX = "polar:";

export interface SubscriptionIntegrityFindings {
  originatedFromPaddleWebhook: boolean;
  originatedFromPolarWebhook: boolean;
  anomalies: string[];
}

/** Pure — no I/O, safe to unit test without a database. */
export function evaluateSubscriptionIntegrity(
  subscription: OrganizationSubscription
): SubscriptionIntegrityFindings {
  const originatedFromPaddleWebhook = subscription.stripeCustomerId.startsWith(
    PADDLE_CUSTOMER_ID_PREFIX
  );
  const originatedFromPolarWebhook = subscription.stripeCustomerId.startsWith(
    POLAR_CUSTOMER_ID_PREFIX
  );

  const anomalies: string[] = [];

  if (!originatedFromPaddleWebhook && !originatedFromPolarWebhook) {
    anomalies.push(
      `stripe_customer_id ("${subscription.stripeCustomerId}") does not match the "${PADDLE_CUSTOMER_ID_PREFIX}<id>" or "${POLAR_CUSTOMER_ID_PREFIX}<id>" convention either webhook always writes — this row may predate those migrations or was not created by the current billing code path.`
    );
  }

  const isActiveStatus =
    subscription.subscriptionStatus === "ACTIVE" ||
    subscription.subscriptionStatus === "TRIALING";

  if (
    isActiveStatus &&
    originatedFromPaddleWebhook &&
    !subscription.paddleSubscriptionId
  ) {
    anomalies.push(
      `subscription_status is "${subscription.subscriptionStatus}" but paddle_subscription_id is null.`
    );
  }

  if (
    isActiveStatus &&
    originatedFromPaddleWebhook &&
    !subscription.paddleCustomerId
  ) {
    anomalies.push(
      `subscription_status is "${subscription.subscriptionStatus}" but paddle_customer_id is null.`
    );
  }

  if (
    isActiveStatus &&
    originatedFromPolarWebhook &&
    !subscription.polarSubscriptionId
  ) {
    anomalies.push(
      `subscription_status is "${subscription.subscriptionStatus}" but polar_subscription_id is null.`
    );
  }

  if (
    isActiveStatus &&
    originatedFromPolarWebhook &&
    !subscription.polarCustomerId
  ) {
    anomalies.push(
      `subscription_status is "${subscription.subscriptionStatus}" but polar_customer_id is null.`
    );
  }

  return { originatedFromPaddleWebhook, originatedFromPolarWebhook, anomalies };
}
