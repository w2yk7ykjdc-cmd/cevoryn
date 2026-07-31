import { AlertTriangle, CreditCard } from "lucide-react";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BillingActions } from "@/features/billing/components/billing-actions";
import {
  getPlanDefinition,
  type BillingPlan,
} from "@/features/billing/config/plans";
import { isSubscriptionActive } from "@/features/billing/types";
import { requireMembership, requireUser } from "@/lib/auth";
import { getOrganizationSubscription } from "@/server/services/billing.service";
import { getPlanPrices } from "@/server/services/paddle-catalog.service";

export const metadata: Metadata = { title: "Billing — CEVORYN" };

export default async function BillingPage() {
  const user = await requireUser();
  const membership = await requireMembership(user.id);
  const t = await getTranslations("billing");
  const tPricing = await getTranslations("pricing");
  const locale = await getLocale();
  const [subscription, planPrices] = await Promise.all([
    getOrganizationSubscription(membership.organizationId),
    getPlanPrices(),
  ]);

  function formatDate(value: Date | null): string {
    if (!value) return t("notAvailable");

    return new Intl.DateTimeFormat(locale, {
      dateStyle: "long",
    }).format(value);
  }

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
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {paymentProblem ? (
        <div className="flex gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div>
            <p className="font-medium">{t("paymentRequired")}</p>
            <p className="text-muted-foreground">
              {t("paymentRequiredDescription")}
            </p>
          </div>
        </div>
      ) : null}

      {subscription?.cancelAtPeriodEnd ? (
        <div className="flex gap-3 rounded-lg border p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-medium">{t("scheduledToEnd")}</p>
            <p className="text-muted-foreground">
              {t("scheduledToEndDescription", {
                date: formatDate(subscription.currentPeriodEnd),
              })}
            </p>
          </div>
        </div>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <CreditCard className="h-4 w-4" />
            {t("currentSubscription")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryItem
            label={t("plan")}
            value={
              <span className="flex items-center gap-2">
                {tPricing(`plans.${currentPlan}.name`)}
                {planDefinition.recommended ? (
                  <Badge>{tPricing("recommended")}</Badge>
                ) : null}
              </span>
            }
          />
          <SummaryItem
            label={t("status")}
            value={subscription?.subscriptionStatus ?? t("noSubscription")}
          />
          <SummaryItem label={t("billingCycle")} value={t("monthly")} />
          <SummaryItem
            label={subscription?.trialEnd ? t("trialEnds") : t("renews")}
            value={formatDate(
              subscription?.trialEnd ?? subscription?.currentPeriodEnd ?? null
            )}
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
