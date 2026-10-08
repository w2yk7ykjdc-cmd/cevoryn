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
    ["STARTER", process.env.POLAR_PRODUCT_STARTER?.trim()],
    ["PROFESSIONAL", process.env.POLAR_PRODUCT_PROFESSIONAL?.trim()],
    ["BUSINESS", process.env.POLAR_PRODUCT_BUSINESS?.trim()],
  ];
  return pairs.find(([, configured]) => configured === productId)?.[0] ?? null;
}

/**
 * Reverse lookup of a Polar product id to the Romance plan it represents.
 * Separate from getBillingPlanFromPolarProductId() (B2B) on purpose - a
 * Romance checkout/webhook event is identified by its own metadata key
 * (romancePlayerId) in the webhook route, never by trying both product-id
 * lookups against one event, but this still gives the webhook handler a
 * second, independent confirmation that the product is the one Romance
 * checkout actually created.
 */
export function getRomancePlanFromPolarProductId(
  productId: string
): "PREMIUM" | null {
  const configured = process.env.POLAR_PRODUCT_ROMANCE_PREMIUM?.trim();
  return configured && configured === productId ? "PREMIUM" : null;
}

const ROMANCE_ACTIVE_POLAR_STATUSES = new Set(["ACTIVE", "TRIALING"]);
const ROMANCE_CANCELED_POLAR_STATUSES = new Set(["CANCELED", "REVOKED"]);

/**
 * Collapses Polar's 8 (well, 9 with "revoked", a webhook-event-type name
 * rather than a status value) subscription statuses onto Romance's
 * simpler 3-value model. Deliberately fails closed: anything not
 * positively known to be active or explicitly canceled (incomplete,
 * incomplete_expired, past_due, unpaid, paused) maps to EXPIRED - a
 * player is never granted PREMIUM access on an ambiguous or
 * payment-troubled status.
 */
export function mapPolarStatusToRomanceStatus(
  status: string | undefined
): "ACTIVE" | "CANCELED" | "EXPIRED" {
  const upper = status?.toUpperCase();
  if (upper && ROMANCE_ACTIVE_POLAR_STATUSES.has(upper)) return "ACTIVE";
  if (upper && ROMANCE_CANCELED_POLAR_STATUSES.has(upper)) return "CANCELED";
  return "EXPIRED";
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

// Event shape verified against a real production webhook delivery payload
// (Polar Dashboard > Webhooks > Deliveries), not the @polar-sh/sdk's
// camelCase TypeScript types - the SDK converts the wire format to
// camelCase internally, but the webhook route parses the raw JSON body
// directly (to verify the Standard Webhooks signature first), so the field
// names below must match the actual snake_case wire format Polar sends.
export type PolarSubscriptionEvent = {
  type: string;
  timestamp?: string;
  data: {
    id?: string;
    status?: string;
    customer_id?: string;
    product_id?: string;
    current_period_start?: string;
    current_period_end?: string;
    cancel_at_period_end?: boolean;
    metadata?: Record<string, unknown>;
  };
};

export function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
