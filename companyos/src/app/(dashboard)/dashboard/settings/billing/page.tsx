import { requirePermission } from "@/server/auth/session";
import { getSubscriptionForOrg } from "@/server/billing/subscription";
import { getUsageSummary } from "@/server/billing/usage";
import { listPlans } from "@/server/billing/plans";
import { isBillingConfigured } from "@/server/billing/provider/registry";
import { BillingClient } from "@/app/(dashboard)/dashboard/settings/billing/billing-client";

export default async function BillingPage() {
  const { organization } = await requirePermission({ billing: ["view"] });

  const [subscription, usage, plans] = await Promise.all([
    getSubscriptionForOrg(organization.id),
    getUsageSummary(organization.id),
    listPlans(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="text-sm text-muted-foreground">Plan, usage, and payment details.</p>
      </div>

      <BillingClient
        billingConfigured={isBillingConfigured()}
        subscription={{
          status: subscription.status,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          currentPeriodEnd: subscription.currentPeriodEnd,
          plan: {
            tier: subscription.plan.tier,
            name: subscription.plan.name,
            monthlyPriceCents: subscription.plan.monthlyPriceCents,
          },
        }}
        usage={usage}
        plans={plans.map((plan) => ({
          tier: plan.tier,
          name: plan.name,
          monthlyPriceCents: plan.monthlyPriceCents,
          aiTokenLimit: plan.aiTokenLimit,
          agentRunLimit: plan.agentRunLimit,
          seatLimit: plan.seatLimit,
        }))}
      />
    </div>
  );
}
