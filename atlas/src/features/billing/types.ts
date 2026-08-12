import type { BillingPlan } from "@/features/billing/config/plans";

export const SUBSCRIPTION_STATUSES = [
  "INCOMPLETE",
  "INCOMPLETE_EXPIRED",
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "CANCELED",
  "UNPAID",
  "PAUSED",
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export interface OrganizationSubscription {
  id: string;
  organizationId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  paddleCustomerId: string | null;
  paddleSubscriptionId: string | null;
  paddlePriceId: string | null;
  polarCustomerId: string | null;
  polarSubscriptionId: string | null;
  polarProductId: string | null;
  plan: BillingPlan;
  subscriptionStatus: SubscriptionStatus;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  trialEnd: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function isSubscriptionActive(status: SubscriptionStatus): boolean {
  return status === "ACTIVE" || status === "TRIALING";
}
