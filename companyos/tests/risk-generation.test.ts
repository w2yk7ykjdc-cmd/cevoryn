import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/client";
import { applyWebhookEvent, getSubscriptionForOrg } from "@/server/billing/subscription";
import { recordSignal } from "@/server/intelligence/signals/service";
import { generateRisksForOrganization, listRisks } from "@/server/intelligence/risk/service";
import { computeCompanyIntelligence } from "@/server/intelligence/compute";
import { closeTestConnections, createOrgForUser, signUpUser } from "./helpers";

/** Attaches a real Stripe-linked pro subscription to the org via the same webhook path production uses. */
async function makeOrgWithPaidSubscription() {
  const owner = await signUpUser();
  const organization = await createOrgForUser(owner);
  const customerId = `cus_${organization.id}`;
  const stripeSubscriptionId = `sub_${organization.id}`;
  const proPlan = await prisma.plan.findUniqueOrThrow({ where: { tier: "pro" } });

  await applyWebhookEvent({
    id: `evt_checkout_${organization.id}`,
    type: "checkout.session.completed",
    data: { object: { client_reference_id: organization.id, customer: customerId, subscription: stripeSubscriptionId } },
  });
  await applyWebhookEvent({
    id: `evt_active_${organization.id}`,
    type: "customer.subscription.updated",
    data: {
      object: { id: stripeSubscriptionId, customer: customerId, status: "active", items: { data: [{ price: { id: proPlan.stripePriceId } }] } },
    },
  });

  const subscription = await getSubscriptionForOrg(organization.id);
  return { owner, organization, subscriptionId: subscription.id, monthlyPriceCents: proPlan.monthlyPriceCents };
}

/**
 * Writes a `billing.subscription_updated` CompanySignal directly via the
 * same shared `recordSignal` the real `record-company-signal` job processor
 * uses, in the same shape it constructs
 * (`src/server/jobs/processors/record-company-signal.ts`) — a real,
 * non-mocked DB write, just skipping the BullMQ hop since Sprint 5's own
 * tests already cover that pipeline end to end.
 */
async function recordBillingSignal(organizationId: string, subscriptionId: string, status: string, severity: "low" | "high") {
  return recordSignal({
    organizationId,
    type: "billing.subscription_updated",
    sourceType: "domain_event",
    sourceId: subscriptionId,
    severity,
    confidence: 100,
    ruleName: "billing.subscription_updated",
    ruleVersion: "v1",
    relatedEntityType: "Subscription",
    relatedEntityId: subscriptionId,
    payload: { organizationId, subscriptionId, status },
  });
}

describe("Risk generation: at_risk_subscription (V1's only rule)", () => {
  afterAll(closeTestConnections);

  it("converts an at-risk (past_due) subscription signal into a Risk", async () => {
    const { organization, subscriptionId, monthlyPriceCents } = await makeOrgWithPaidSubscription();
    await recordBillingSignal(organization.id, subscriptionId, "past_due", "high");

    const result = await generateRisksForOrganization(organization.id);
    expect(result.risksCreated).toBe(1);
    expect(result.risksUpdated).toBe(0);

    const risk = await prisma.risk.findFirst({ where: { organizationId: organization.id, relatedEntityId: subscriptionId } });
    expect(risk).not.toBeNull();
    expect(risk?.ruleName).toBe("at_risk_subscription");
    expect(risk?.severity).toBe("high");
    expect(risk?.status).toBe("open");
    expect(Number(risk?.potentialLoss)).toBe(monthlyPriceCents / 100);
    expect(risk?.explanation).toContain("past_due");
  });

  it("does not create a Risk for a healthy (low-severity) signal", async () => {
    const { organization, subscriptionId } = await makeOrgWithPaidSubscription();
    await recordBillingSignal(organization.id, subscriptionId, "active", "low");

    const result = await generateRisksForOrganization(organization.id);
    expect(result.risksCreated).toBe(0);

    const count = await prisma.risk.count({ where: { organizationId: organization.id } });
    expect(count).toBe(0);
  });

  it("re-running generation on an already-flagged signal upserts the same Risk, not a duplicate", async () => {
    const { organization, subscriptionId } = await makeOrgWithPaidSubscription();
    await recordBillingSignal(organization.id, subscriptionId, "past_due", "high");

    await generateRisksForOrganization(organization.id);
    const second = await generateRisksForOrganization(organization.id);

    expect(second.risksCreated).toBe(0);
    expect(second.risksUpdated).toBe(1);

    const all = await prisma.risk.findMany({ where: { organizationId: organization.id } });
    expect(all).toHaveLength(1);
  });

  it("auto-resolves an open Risk once the underlying subscription recovers", async () => {
    const { organization, subscriptionId } = await makeOrgWithPaidSubscription();
    await recordBillingSignal(organization.id, subscriptionId, "past_due", "high");
    await generateRisksForOrganization(organization.id);

    // The subscription recovers: the same signal row is refreshed to healthy, exactly as `recordSignal`'s upsert does in production.
    await recordBillingSignal(organization.id, subscriptionId, "active", "low");
    const result = await generateRisksForOrganization(organization.id);
    expect(result.risksResolved).toBe(1);

    const risk = await prisma.risk.findFirstOrThrow({ where: { organizationId: organization.id, relatedEntityId: subscriptionId } });
    expect(risk.status).toBe("resolved");
    expect(risk.resolvedAt).not.toBeNull();
  });

  it("never auto-resolves a Risk a human has already dismissed", async () => {
    const { organization, subscriptionId } = await makeOrgWithPaidSubscription();
    await recordBillingSignal(organization.id, subscriptionId, "past_due", "high");
    await generateRisksForOrganization(organization.id);

    const risk = await prisma.risk.findFirstOrThrow({ where: { organizationId: organization.id, relatedEntityId: subscriptionId } });
    await prisma.risk.update({ where: { id: risk.id }, data: { status: "dismissed" } });

    await recordBillingSignal(organization.id, subscriptionId, "active", "low");
    const result = await generateRisksForOrganization(organization.id);
    expect(result.risksResolved).toBe(0);

    const refreshed = await prisma.risk.findUniqueOrThrow({ where: { id: risk.id } });
    expect(refreshed.status).toBe("dismissed");
  });

  it("skips generation when the underlying subscription no longer exists", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await recordBillingSignal(organization.id, "sub-that-does-not-exist", "past_due", "high");

    const result = await generateRisksForOrganization(organization.id);
    expect(result.risksCreated).toBe(0);
  });

  it("only generates and lists risks scoped to their own organization", async () => {
    const orgA = await makeOrgWithPaidSubscription();
    await recordBillingSignal(orgA.organization.id, orgA.subscriptionId, "past_due", "high");

    const orgB = await makeOrgWithPaidSubscription();
    await recordBillingSignal(orgB.organization.id, orgB.subscriptionId, "past_due", "high");

    await generateRisksForOrganization(orgA.organization.id);

    const { risks: risksA } = await listRisks({ organizationId: orgA.organization.id });
    const { risks: risksB } = await listRisks({ organizationId: orgB.organization.id });
    expect(risksA).toHaveLength(1);
    expect(risksB).toHaveLength(0); // orgB's signal exists, but was never generated for orgB
  });

  it("computeCompanyIntelligence generates risks for every organization alongside health snapshots and opportunities", async () => {
    const { organization, subscriptionId } = await makeOrgWithPaidSubscription();
    await recordBillingSignal(organization.id, subscriptionId, "past_due", "high");

    const result = await computeCompanyIntelligence();
    expect(result.risksCreated).toBeGreaterThanOrEqual(1);

    const { risks } = await listRisks({ organizationId: organization.id });
    expect(risks).toHaveLength(1);
  });
});
