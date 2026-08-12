import type { BillingPlan } from "@/features/billing/config/plans";

/**
 * Pure, I/O-free helpers for interpreting Polar subscription webhook
 * events. Kept separate from the webhook route (and from
 * src/lib/polar/config.ts, which imports "server-only") so this module
 * stays importable from plain Node test files.
 */

/**
 * Reverse lookup of a Polar product id to the CEVORYN plan it represents.
 * Returns null for anything not explicitly configured - callers must
 * reject unknown products rather than guessing a plan.
 */
export function getBillingPlanFromPolarProductId(
  productId: string
): BillingPlan | null {
  const pairs: Array<[BillingPlan, string | undefined]> = [
    ["STARTER", process.env.POLAR_PRODUCT_STARTER],
    ["PROFESSIONAL", process.env.POLAR_PRODUCT_PROFESSIONAL],
    ["BUSINESS", process.env.POLAR_PRODUCT_BUSINESS],
  ];
  return pairs.find(([, configured]) => configured === productId)?.[0] ?? null;
}

/**
 * Event types this integration acts on. Verified against @polar-sh/sdk
 * 0.49.0 (src/webhooks.ts parseEvent switch) - these are real event names,
 * not guessed. Polar also sends checkout.*, order.*, product.*,
 * customer.*, benefit.*, member.*, refund.*, organization.updated events
 * that this integration deliberately does not subscribe to.
 */
export const SUPPORTED_POLAR_EVENT_TYPES = new Set([
  "subscription.created",
  "subscription.active",
  "subscription.updated",
  "subscription.canceled",
  "subscription.uncanceled",
  "subscription.revoked",
  "subscription.past_due",
]);

const KNOWN_SUBSCRIPTION_STATUSES = new Set([
  "INCOMPLETE",
  "INCOMPLETE_EXPIRED",
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "CANCELED",
  "UNPAID",
  "PAUSED",
]);

/**
 * Polar's SubscriptionStatus values (incomplete, incomplete_expired,
 * trialing, active, past_due, canceled, unpaid, paused) map 1:1 onto our
 * SubscriptionStatus enum by uppercasing - verified against
 * @polar-sh/sdk's src/models/components/subscriptionstatus.ts.
 */
export function mapPolarSubscriptionStatus(status: string | undefined): string {
  const upper = status?.toUpperCase();
  return upper && KNOWN_SUBSCRIPTION_STATUSES.has(upper) ? upper : "INCOMPLETE";
}
