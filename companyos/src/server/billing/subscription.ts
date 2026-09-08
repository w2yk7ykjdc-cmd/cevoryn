import type { Prisma, Subscription, SubscriptionStatus } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { getPlanByTier } from "@/server/billing/plans";
import { getPaymentProvider } from "@/server/billing/provider/registry";
import type { PaymentProvider, WebhookEvent } from "@/server/billing/provider/types";
import { recordAuditLog, publishAuditEvent } from "@/server/audit/audit-log";
import { publishEvent } from "@/server/events/event-bus";
import { env } from "@/env";
import { logger } from "@/server/logger/logger";

export class SubscriptionNotFoundError extends Error {
  constructor(organizationId: string) {
    super(`No subscription found for organization "${organizationId}"`);
    this.name = "SubscriptionNotFoundError";
  }
}

/** Every organization gets a Free-tier subscription the moment it's created — see `afterCreateOrganization` in auth.ts. */
export async function provisionDefaultSubscription(organizationId: string): Promise<Subscription> {
  const freePlan = await getPlanByTier("free");
  const now = new Date();

  return prisma.subscription.upsert({
    where: { organizationId },
    create: {
      organizationId,
      planId: freePlan.id,
      status: "active",
      currentPeriodStart: now,
      currentPeriodEnd: addOneMonth(now),
    },
    update: {},
  });
}

export async function getSubscriptionForOrg(organizationId: string) {
  const subscription = await prisma.subscription.findUnique({
    where: { organizationId },
    include: { plan: true },
  });
  if (!subscription) throw new SubscriptionNotFoundError(organizationId);
  return subscription;
}

export type CreateCheckoutInput = {
  organizationId: string;
  actorEmail: string;
  tier: "pro" | "enterprise";
};

/**
 * Starts a Stripe Checkout session to upgrade to a paid tier. Accepts an
 * injected `provider` for tests — Stripe is a genuinely external,
 * non-deterministic-to-test service, so it's exercised through this same
 * interface-substitution pattern Sprint 2 used for `AIProvider`, not
 * mocked internals.
 */
export async function createCheckoutSessionForOrg(
  input: CreateCheckoutInput,
  provider?: PaymentProvider,
): Promise<{ url: string }> {
  const plan = await getPlanByTier(input.tier);
  if (!plan.stripePriceId) {
    throw new Error(`Plan "${input.tier}" has no configured Stripe price — set STRIPE_PRICE_ID_${input.tier.toUpperCase()}`);
  }
  const subscription = await getSubscriptionForOrg(input.organizationId);

  return (provider ?? getPaymentProvider()).createCheckoutSession({
    organizationId: input.organizationId,
    customerId: subscription.stripeCustomerId ?? undefined,
    customerEmail: subscription.stripeCustomerId ? undefined : input.actorEmail,
    priceId: plan.stripePriceId,
    successUrl: `${env.APP_URL}/dashboard/settings/billing?checkout=success`,
    cancelUrl: `${env.APP_URL}/dashboard/settings/billing?checkout=cancelled`,
  });
}

/** Opens Stripe's self-service billing portal (payment method, invoices, cancel/upgrade). */
export async function createBillingPortalSessionForOrg(
  organizationId: string,
  provider?: PaymentProvider,
): Promise<{ url: string }> {
  const subscription = await getSubscriptionForOrg(organizationId);
  if (!subscription.stripeCustomerId) {
    throw new Error("This organization has no billing account yet — subscribe to a paid plan first.");
  }
  return (provider ?? getPaymentProvider()).createBillingPortalSession({
    customerId: subscription.stripeCustomerId,
    returnUrl: `${env.APP_URL}/dashboard/settings/billing`,
  });
}

/** Requests cancellation directly (in addition to the self-service portal). The webhook reconciles authoritative state. */
export async function cancelSubscriptionForOrg(
  organizationId: string,
  actorId: string,
  provider?: PaymentProvider,
): Promise<void> {
  const subscription = await getSubscriptionForOrg(organizationId);
  if (!subscription.stripeSubscriptionId) {
    throw new Error("This organization has no active paid subscription to cancel.");
  }

  await (provider ?? getPaymentProvider()).cancelSubscription(subscription.stripeSubscriptionId);

  await prisma.subscription.update({
    where: { id: subscription.id },
    data: { cancelAtPeriodEnd: true },
  });

  await recordAuditLog({
    organizationId,
    actorId,
    actorType: "user",
    action: "billing.subscription_cancel_requested",
    targetType: "subscription",
    targetId: subscription.id,
    metadata: {},
  });
}

const STRIPE_STATUS_MAP: Record<string, SubscriptionStatus> = {
  trialing: "trialing",
  active: "active",
  past_due: "past_due",
  canceled: "canceled",
  incomplete: "incomplete",
  incomplete_expired: "canceled",
  unpaid: "past_due",
  paused: "canceled",
};

type SubscriptionEventDescriptor = { organizationId: string; subscriptionId: string; status: string };
type AuditEntry = Awaited<ReturnType<typeof recordAuditLog>>;
type ApplyOutcome = { auditEntry: AuditEntry | null; subscriptionEvent: SubscriptionEventDescriptor | null };

/**
 * Applies one inbound Stripe webhook event. Idempotent and retry-safe: the
 * event's own Stripe id is inserted into `BillingWebhookEvent` in the same
 * database transaction as the event's side effects (subscription
 * update(s) + audit log). If applying the effects throws for any reason,
 * the whole transaction — including the idempotency insert — rolls back,
 * so a Stripe retry of the same event is genuinely retried rather than
 * being mistaken for an already-processed duplicate. Only a transaction
 * that fully committed is treated as "processed"; a concurrent redelivery
 * of the very same event racing this one is caught as a unique-constraint
 * violation and safely ignored. Redis-touching side effects (audit event
 * fan-out, the `billing.subscription_updated` domain event) intentionally
 * run *after* the transaction commits, so a slow/unavailable Redis never
 * holds the database transaction open.
 */
export async function applyWebhookEvent(event: WebhookEvent): Promise<{ applied: boolean }> {
  let outcome: ApplyOutcome;

  try {
    outcome = await prisma.$transaction(async (tx) => {
      await tx.billingWebhookEvent.create({
        data: { id: event.id, type: event.type, payload: event.data as unknown as Prisma.InputJsonValue },
      });

      switch (event.type) {
        case "checkout.session.completed":
          await applyCheckoutCompleted(event.data.object, tx);
          return { auditEntry: null, subscriptionEvent: null };
        case "customer.subscription.updated":
        case "customer.subscription.created":
          return applySubscriptionSync(event.data.object, tx);
        case "customer.subscription.deleted":
          return applySubscriptionDeleted(event.data.object, tx);
        default:
          // Every other Stripe event type is safely ignored — we only need
          // the subscription lifecycle, not the full event catalog.
          return { auditEntry: null, subscriptionEvent: null };
      }
    });
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      logger.info({ eventId: event.id, type: event.type }, "duplicate billing webhook event ignored");
      return { applied: false };
    }
    throw err;
  }

  if (outcome.auditEntry) {
    await publishAuditEvent(outcome.auditEntry);
  }
  if (outcome.subscriptionEvent) {
    await publishEvent("billing.subscription_updated", outcome.subscriptionEvent, {
      organizationId: outcome.subscriptionEvent.organizationId,
    });
  }

  return { applied: true };
}

async function applyCheckoutCompleted(raw: Record<string, unknown>, tx: Prisma.TransactionClient): Promise<void> {
  const organizationId = typeof raw.client_reference_id === "string" ? raw.client_reference_id : undefined;
  const customerId = typeof raw.customer === "string" ? raw.customer : undefined;
  const subscriptionId = typeof raw.subscription === "string" ? raw.subscription : undefined;
  if (!organizationId || !customerId || !subscriptionId) {
    logger.warn({ raw }, "checkout.session.completed missing expected fields");
    return;
  }

  await tx.subscription.update({
    where: { organizationId },
    data: { stripeCustomerId: customerId, stripeSubscriptionId: subscriptionId },
  });
}

async function applySubscriptionSync(raw: Record<string, unknown>, tx: Prisma.TransactionClient): Promise<ApplyOutcome> {
  const stripeSubscriptionId = typeof raw.id === "string" ? raw.id : undefined;
  const stripeCustomerId = typeof raw.customer === "string" ? raw.customer : undefined;
  if (!stripeSubscriptionId && !stripeCustomerId) return { auditEntry: null, subscriptionEvent: null };

  const existing = await tx.subscription.findFirst({
    where: { OR: [{ stripeSubscriptionId: stripeSubscriptionId ?? undefined }, { stripeCustomerId: stripeCustomerId ?? undefined }] },
  });
  if (!existing) {
    logger.warn({ stripeSubscriptionId, stripeCustomerId }, "subscription webhook for unknown organization");
    return { auditEntry: null, subscriptionEvent: null };
  }

  const rawStatus = typeof raw.status === "string" ? raw.status : undefined;
  const status = rawStatus ? (STRIPE_STATUS_MAP[rawStatus] ?? existing.status) : existing.status;

  const items = raw.items as { data?: { price?: { id?: string } }[] } | undefined;
  const priceId = items?.data?.[0]?.price?.id;
  const plan = priceId ? await tx.plan.findFirst({ where: { stripePriceId: priceId } }) : null;

  const periodStartSec = typeof raw.current_period_start === "number" ? raw.current_period_start : undefined;
  const periodEndSec = typeof raw.current_period_end === "number" ? raw.current_period_end : undefined;
  const cancelAtPeriodEnd = raw.cancel_at_period_end === true;

  await tx.subscription.update({
    where: { id: existing.id },
    data: {
      stripeCustomerId: stripeCustomerId ?? existing.stripeCustomerId,
      stripeSubscriptionId: stripeSubscriptionId ?? existing.stripeSubscriptionId,
      status,
      planId: plan?.id ?? existing.planId,
      currentPeriodStart: periodStartSec ? new Date(periodStartSec * 1000) : existing.currentPeriodStart,
      currentPeriodEnd: periodEndSec ? new Date(periodEndSec * 1000) : existing.currentPeriodEnd,
      cancelAtPeriodEnd,
    },
  });

  const auditEntry = await recordAuditLog(
    {
      organizationId: existing.organizationId,
      actorId: null,
      actorType: "system",
      action: "billing.subscription_updated",
      targetType: "subscription",
      targetId: existing.id,
      metadata: { status, planId: plan?.id ?? existing.planId },
    },
    tx,
  );

  return {
    auditEntry,
    subscriptionEvent: { organizationId: existing.organizationId, subscriptionId: existing.id, status },
  };
}

async function applySubscriptionDeleted(raw: Record<string, unknown>, tx: Prisma.TransactionClient): Promise<ApplyOutcome> {
  const stripeSubscriptionId = typeof raw.id === "string" ? raw.id : undefined;
  if (!stripeSubscriptionId) return { auditEntry: null, subscriptionEvent: null };

  const existing = await tx.subscription.findFirst({ where: { stripeSubscriptionId } });
  if (!existing) return { auditEntry: null, subscriptionEvent: null };

  const freePlan = await getPlanByTier("free");
  await tx.subscription.update({
    where: { id: existing.id },
    data: {
      planId: freePlan.id,
      status: "canceled",
      stripeSubscriptionId: null,
      cancelAtPeriodEnd: false,
    },
  });

  const auditEntry = await recordAuditLog(
    {
      organizationId: existing.organizationId,
      actorId: null,
      actorType: "system",
      action: "billing.subscription_updated",
      targetType: "subscription",
      targetId: existing.id,
      metadata: { status: "canceled", planId: freePlan.id },
    },
    tx,
  );

  return {
    auditEntry,
    subscriptionEvent: { organizationId: existing.organizationId, subscriptionId: existing.id, status: "canceled" },
  };
}

function addOneMonth(date: Date): Date {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

function isUniqueConstraintViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "P2002";
}
