import type Stripe from "stripe";

import type { BillingPlan } from "@/features/billing/config/plans";
import type { SubscriptionStatus } from "@/features/billing/types";
import { getPlanForStripePriceId } from "@/lib/stripe/config";
import type { SubscriptionSyncInput } from "@/server/services/billing.service";

interface StripeSubscriptionPeriodShape {
  current_period_start?: number;
  current_period_end?: number;
  trial_end?: number | null;
}

export function mapStripeSubscriptionStatus(
  status: Stripe.Subscription.Status
): SubscriptionStatus {
  switch (status) {
    case "incomplete":
      return "INCOMPLETE";
    case "incomplete_expired":
      return "INCOMPLETE_EXPIRED";
    case "trialing":
      return "TRIALING";
    case "active":
      return "ACTIVE";
    case "past_due":
      return "PAST_DUE";
    case "canceled":
      return "CANCELED";
    case "unpaid":
      return "UNPAID";
    case "paused":
      return "PAUSED";
    default: {
      const exhaustiveStatus: never = status;
      throw new Error(`Unsupported Stripe subscription status: ${exhaustiveStatus}`);
    }
  }
}

function unixTimestampToDate(value: number | null | undefined): Date | null {
  return typeof value === "number" ? new Date(value * 1000) : null;
}

function getStripeCustomerId(customer: string | Stripe.Customer | Stripe.DeletedCustomer): string {
  return typeof customer === "string" ? customer : customer.id;
}

export function getSubscriptionPriceId(
  subscription: Stripe.Subscription
): string | null {
  return subscription.items.data[0]?.price.id ?? null;
}

export function getSubscriptionOrganizationId(
  subscription: Stripe.Subscription
): string | null {
  return subscription.metadata.organizationId ?? null;
}

export function mapStripeSubscription(
  subscription: Stripe.Subscription,
  organizationId: string,
  fallbackPlan: BillingPlan = "STARTER"
): SubscriptionSyncInput {
  const priceId = getSubscriptionPriceId(subscription);
  const plan = priceId ? getPlanForStripePriceId(priceId) : null;
  const period = subscription as Stripe.Subscription & StripeSubscriptionPeriodShape;

  return {
    organizationId,
    stripeCustomerId: getStripeCustomerId(subscription.customer),
    stripeSubscriptionId: subscription.id,
    stripePriceId: priceId,
    plan: plan ?? fallbackPlan,
    subscriptionStatus: mapStripeSubscriptionStatus(subscription.status),
    currentPeriodStart: unixTimestampToDate(period.current_period_start),
    currentPeriodEnd: unixTimestampToDate(period.current_period_end),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    trialEnd: unixTimestampToDate(period.trial_end),
  };
}
