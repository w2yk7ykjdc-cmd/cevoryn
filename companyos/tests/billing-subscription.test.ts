import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/client";
import {
  cancelSubscriptionForOrg,
  createBillingPortalSessionForOrg,
  createCheckoutSessionForOrg,
  getSubscriptionForOrg,
  applyWebhookEvent,
} from "@/server/billing/subscription";
import type { WebhookEvent } from "@/server/billing/provider/types";
import { closeTestConnections, createOrgForUser, signUpUser } from "./helpers";
import { createFakePaymentProvider } from "./fake-payment-provider";

describe("billing: subscription provisioning + Stripe lifecycle", () => {
  afterAll(closeTestConnections);

  it("provisions a free subscription automatically when an organization is created", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    const subscription = await getSubscriptionForOrg(organization.id);

    expect(subscription.plan.tier).toBe("free");
    expect(subscription.status).toBe("active");
    expect(subscription.stripeCustomerId).toBeNull();
    expect(subscription.currentPeriodEnd.getTime()).toBeGreaterThan(subscription.currentPeriodStart.getTime());
  });

  it("createCheckoutSessionForOrg returns a checkout URL for a paid tier", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const provider = createFakePaymentProvider();

    const result = await createCheckoutSessionForOrg(
      { organizationId: organization.id, actorEmail: owner.email, tier: "pro" },
      provider,
    );

    expect(result.url).toContain(organization.id);
  });

  it("createBillingPortalSessionForOrg refuses when the org has no Stripe customer yet", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const provider = createFakePaymentProvider();

    await expect(createBillingPortalSessionForOrg(organization.id, provider)).rejects.toThrow(/no billing account/i);
  });

  it("cancelSubscriptionForOrg refuses when there's no active paid subscription", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const provider = createFakePaymentProvider();

    await expect(cancelSubscriptionForOrg(organization.id, owner.userId, provider)).rejects.toThrow(
      /no active paid subscription/i,
    );
  });

  it("applyWebhookEvent(checkout.session.completed) links the Stripe customer + subscription to the org", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    const customerId = `cus_${organization.id}`;
    const subscriptionId = `sub_${organization.id}`;
    const event: WebhookEvent = {
      id: `evt_checkout_${organization.id}`,
      type: "checkout.session.completed",
      data: {
        object: {
          client_reference_id: organization.id,
          customer: customerId,
          subscription: subscriptionId,
        },
      },
    };

    const { applied } = await applyWebhookEvent(event);
    expect(applied).toBe(true);

    const subscription = await getSubscriptionForOrg(organization.id);
    expect(subscription.stripeCustomerId).toBe(customerId);
    expect(subscription.stripeSubscriptionId).toBe(subscriptionId);
  });

  it("applyWebhookEvent(customer.subscription.updated) syncs status, plan, and period from Stripe", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const customerId = `cus_${organization.id}`;
    const subscriptionId = `sub_${organization.id}`;

    await applyWebhookEvent({
      id: `evt_checkout_${organization.id}`,
      type: "checkout.session.completed",
      data: { object: { client_reference_id: organization.id, customer: customerId, subscription: subscriptionId } },
    });

    const proPlan = await prisma.plan.findUniqueOrThrow({ where: { tier: "pro" } });
    const periodStart = Math.floor(Date.now() / 1000);
    const periodEnd = periodStart + 30 * 24 * 60 * 60;

    const { applied } = await applyWebhookEvent({
      id: `evt_update_${organization.id}`,
      type: "customer.subscription.updated",
      data: {
        object: {
          id: subscriptionId,
          customer: customerId,
          status: "active",
          items: { data: [{ price: { id: proPlan.stripePriceId } }] },
          current_period_start: periodStart,
          current_period_end: periodEnd,
          cancel_at_period_end: false,
        },
      },
    });
    expect(applied).toBe(true);

    const subscription = await getSubscriptionForOrg(organization.id);
    expect(subscription.status).toBe("active");
    expect(subscription.plan.tier).toBe("pro");
    expect(subscription.currentPeriodEnd.getTime()).toBe(periodEnd * 1000);

    const auditEntry = await prisma.auditLog.findFirst({
      where: { organizationId: organization.id, action: "billing.subscription_updated" },
    });
    expect(auditEntry).not.toBeNull();
  });

  it("applyWebhookEvent(customer.subscription.deleted) downgrades the org back to the free plan", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const customerId = `cus_${organization.id}`;
    const subscriptionId = `sub_${organization.id}`;

    await applyWebhookEvent({
      id: `evt_checkout_${organization.id}`,
      type: "checkout.session.completed",
      data: { object: { client_reference_id: organization.id, customer: customerId, subscription: subscriptionId } },
    });

    const { applied } = await applyWebhookEvent({
      id: `evt_delete_${organization.id}`,
      type: "customer.subscription.deleted",
      data: { object: { id: subscriptionId } },
    });
    expect(applied).toBe(true);

    const subscription = await getSubscriptionForOrg(organization.id);
    expect(subscription.plan.tier).toBe("free");
    expect(subscription.status).toBe("canceled");
    expect(subscription.stripeSubscriptionId).toBeNull();
  });

  it("applyWebhookEvent is idempotent — a redelivered event id is applied only once", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    const event: WebhookEvent = {
      id: `evt_idempotent_${organization.id}`,
      type: "checkout.session.completed",
      data: {
        object: {
          client_reference_id: organization.id,
          customer: `cus_${organization.id}`,
          subscription: `sub_${organization.id}`,
        },
      },
    };

    const first = await applyWebhookEvent(event);
    const second = await applyWebhookEvent(event);

    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);

    const stored = await prisma.billingWebhookEvent.findMany({ where: { id: event.id } });
    expect(stored).toHaveLength(1);
  });
});
