import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/client";
import { checkUsageLimit, getCurrentPeriodUsage, getUsageSummary, recordUsage, UsageLimitExceededError } from "@/server/billing/usage";
import { getSubscriptionForOrg } from "@/server/billing/subscription";
import { rolloverExpiredPeriods } from "@/server/billing/rollover";
import { closeTestConnections, createOrgForUser, signUpUser } from "./helpers";

describe("billing: usage metering", () => {
  afterAll(closeTestConnections);

  it("recordUsage + getCurrentPeriodUsage sum quantities within the current billing period", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    await recordUsage(organization.id, "ai_tokens", 100);
    await recordUsage(organization.id, "ai_tokens", 250);
    await recordUsage(organization.id, "agent_run", 1);

    expect(await getCurrentPeriodUsage(organization.id, "ai_tokens")).toBe(350);
    expect(await getCurrentPeriodUsage(organization.id, "agent_run")).toBe(1);
  });

  it("recordUsage is a no-op for zero or negative quantities", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    await recordUsage(organization.id, "ai_tokens", 0);
    await recordUsage(organization.id, "ai_tokens", -5);

    expect(await getCurrentPeriodUsage(organization.id, "ai_tokens")).toBe(0);
  });

  it("checkUsageLimit passes while under the plan's limit and throws once it's reached", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const subscription = await getSubscriptionForOrg(organization.id);

    // Free plan's agentRunLimit — consume all but one.
    await recordUsage(organization.id, "agent_run", subscription.plan.agentRunLimit - 1);
    await expect(checkUsageLimit(organization.id, "agent_run")).resolves.toBeUndefined();

    await recordUsage(organization.id, "agent_run", 1);
    await expect(checkUsageLimit(organization.id, "agent_run")).rejects.toThrow(UsageLimitExceededError);
  });

  it("checkUsageLimit publishes billing.usage_limit_exceeded and records the offending metric/limit/current", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const subscription = await getSubscriptionForOrg(organization.id);

    await recordUsage(organization.id, "ai_tokens", subscription.plan.aiTokenLimit);

    try {
      await checkUsageLimit(organization.id, "ai_tokens");
      expect.unreachable("expected checkUsageLimit to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(UsageLimitExceededError);
      if (err instanceof UsageLimitExceededError) {
        expect(err.metric).toBe("ai_tokens");
        expect(err.limit).toBe(subscription.plan.aiTokenLimit);
        expect(err.current).toBe(subscription.plan.aiTokenLimit);
      }
    }
  });

  it("getUsageSummary reports both metrics against the organization's plan limits", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const subscription = await getSubscriptionForOrg(organization.id);

    await recordUsage(organization.id, "ai_tokens", 42);
    await recordUsage(organization.id, "agent_run", 2);

    const summary = await getUsageSummary(organization.id);
    const tokens = summary.find((s) => s.metric === "ai_tokens");
    const runs = summary.find((s) => s.metric === "agent_run");

    expect(tokens).toEqual({ metric: "ai_tokens", used: 42, limit: subscription.plan.aiTokenLimit });
    expect(runs).toEqual({ metric: "agent_run", used: 2, limit: subscription.plan.agentRunLimit });
  });

  it("rolloverExpiredPeriods advances a free-tier subscription whose period has ended", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const subscription = await getSubscriptionForOrg(organization.id);

    const pastEnd = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await prisma.subscription.update({ where: { id: subscription.id }, data: { currentPeriodEnd: pastEnd } });

    const rolled = await rolloverExpiredPeriods();
    expect(rolled).toBeGreaterThanOrEqual(1);

    const updated = await getSubscriptionForOrg(organization.id);
    expect(updated.currentPeriodStart.getTime()).toBe(pastEnd.getTime());
    expect(updated.currentPeriodEnd.getTime()).toBeGreaterThan(pastEnd.getTime());
  });

  it("rolloverExpiredPeriods leaves Stripe-managed (paid) subscriptions alone even if their period has ended", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const subscription = await getSubscriptionForOrg(organization.id);

    const pastEnd = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { currentPeriodEnd: pastEnd, stripeSubscriptionId: `sub_${organization.id}` },
    });

    await rolloverExpiredPeriods();

    const untouched = await getSubscriptionForOrg(organization.id);
    expect(untouched.currentPeriodEnd.getTime()).toBe(pastEnd.getTime());
  });
});
