import { AlertTriangle, CreditCard } from "lucide-react";
import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BillingActions } from "@/features/billing/components/billing-actions";
import { getPlanDefinition, type BillingPlan } from "@/features/billing/config/plans";
import { isSubscriptionActive } from "@/features/billing/types";
import { requireMembership, requireUser } from "@/lib/auth";
import { getOrganizationSubscription } from "@/server/services/billing.service";
import { getPlanPrices } from "@/server/services/paddle-catalog.service";

export const metadata: Metadata = { title: "Billing — CEVORYN" };

function formatDate(value: Date | null): string {
  if (!value) return "Not available";

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
  }).format(value);
}

export default async function BillingPage() {
  const user = await requireUser();
  const membership = await requireMembership(user.id);
  const [subscription, planPrices] = await Promise.all([
    getOrganizationSubscription(membership.organizationId),
    getPlanPrices(),
  ]);

  const currentPlan: BillingPlan = subscription?.plan ?? "STARTER";
  const planDefinition = getPlanDefinition(currentPlan);
  const active = subscription
    ? isSubscriptionActive(subscription.subscriptionStatus)
    : false;
  const canManage = membership.role === "OWNER" || membership.role === "ADMIN";
  const paymentProblem =
    subscription?.subscriptionStatus === "PAST_DUE" ||
    subscription?.subscriptionStatus === "UNPAID";

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Billing</h1>
        <p className="text-sm text-muted-foreground">
          Manage your CEVORYN subscription and organization limits.
        </p>
      </div>

      {paymentProblem ? (
        <div className="flex gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div>
            <p className="font-medium">Payment action required</p>
            <p className="text-muted-foreground">
              Your latest payment was unsuccessful. Open Manage Billing to update
              the payment method and keep premium features active.
            </p>
          </div>
        </div>
      ) : null}

      {subscription?.cancelAtPeriodEnd ? (
        <div className="flex gap-3 rounded-lg border p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-medium">Subscription scheduled to end</p>
            <p className="text-muted-foreground">
              Access remains available until {formatDate(subscription.currentPeriodEnd)}.
              You can reactivate the subscription from Manage Billing.
            </p>
          </div>
        </div>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <CreditCard className="h-4 w-4" />
            Current subscription
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryItem
            label="Plan"
            value={
              <span className="flex items-center gap-2">
                {planDefinition.name}
                {planDefinition.recommended ? <Badge>Recommended</Badge> : null}
              </span>
            }
          />
          <SummaryItem
            label="Status"
            value={subscription?.subscriptionStatus ?? "NO SUBSCRIPTION"}
          />
          <SummaryItem
            label="Billing cycle"
            value="Monthly"
          />
          <SummaryItem
            label={subscription?.trialEnd ? "Trial ends" : "Renews"}
            value={formatDate(subscription?.trialEnd ?? subscription?.currentPeriodEnd ?? null)}
          />
        </CardContent>
      </Card>

      <BillingActions
        currentPlan={currentPlan}
        hasBillingAccount={Boolean(subscription?.stripeCustomerId)}
        hasActiveSubscription={active}
        canManage={canManage}
        planPrices={planPrices}
      />
    </div>
  );
}

function SummaryItem({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="space-y-1 rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}
