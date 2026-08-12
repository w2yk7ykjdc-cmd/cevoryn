"use client";

import { Check, CreditCard, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BILLING_FEATURES,
  BILLING_PLANS,
  getPlanDefinition,
  type BillingPlan,
} from "@/features/billing/config/plans";
import type { PlanPrice } from "@/server/services/polar-catalog.service";

type BillingTranslator = ReturnType<typeof useTranslations<"billing">>;
type PricingTranslator = ReturnType<typeof useTranslations<"pricing">>;

type PolarCheckoutResponse = {
  url?: string;
  error?: string;
};

interface BillingActionsProps {
  currentPlan: BillingPlan;
  hasBillingAccount: boolean;
  hasActiveSubscription: boolean;
  canManage: boolean;
  planPrices: Partial<Record<BillingPlan, PlanPrice>>;
}

export function formatPlanPrice(price: PlanPrice): string {
  const amount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: price.currencyCode,
    minimumFractionDigits: price.amount % 1 === 0 ? 0 : 2,
  }).format(price.amount);

  return `${amount}/${price.interval}`;
}

export function formatMemberLimit(
  maxMembers: number,
  t: PricingTranslator
): string {
  return maxMembers === 1
    ? t("memberLimitOne")
    : t("memberLimit", { count: maxMembers });
}

export function formatTokenLimit(
  monthlyAiTokens: number,
  t: BillingTranslator
): string {
  const millions = monthlyAiTokens / 1_000_000;
  if (millions >= 1) {
    return t("tokenLimitMillions", {
      count: Number.isInteger(millions) ? millions : millions.toFixed(1),
    });
  }

  const thousands = monthlyAiTokens / 1_000;
  return t("tokenLimitThousands", {
    count: Number.isInteger(thousands) ? thousands : thousands.toFixed(1),
  });
}

export function BillingActions({
  currentPlan,
  hasBillingAccount,
  hasActiveSubscription,
  canManage,
  planPrices,
}: BillingActionsProps) {
  const t = useTranslations("billing");
  const tPricing = useTranslations("pricing");
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  async function openCheckout(plan: BillingPlan) {
    const action = `checkout:${plan}`;
    try {
      setPendingAction(action);
      const response = await fetch("/api/billing/polar/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const result = (await response.json()) as PolarCheckoutResponse;

      if (!response.ok || !result.url) {
        throw new Error(result.error ?? t("billingRequestFailed"));
      }

      window.location.assign(result.url);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("billingUnavailable")
      );
      setPendingAction(null);
    }
  }

  async function changePlan(plan: BillingPlan) {
    const action = `checkout:${plan}`;
    try {
      setPendingAction(action);
      const response = await fetch("/api/billing/change-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const result = (await response.json()) as {
        success?: boolean;
        error?: string;
      };

      if (!response.ok || !result.success) {
        throw new Error(result.error ?? t("planChangeFailed"));
      }

      toast.success(
        t("planChangeProcessing", { plan: tPricing(`plans.${plan}.name`) })
      );
      window.location.reload();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("billingUnavailable")
      );
      setPendingAction(null);
    }
  }

  async function openPortal() {
    try {
      setPendingAction("portal");
      const response = await fetch("/api/billing/portal", { method: "POST" });
      const result = (await response.json()) as {
        url?: string;
        error?: string;
      };
      if (!response.ok || !result.url) {
        throw new Error(result.error ?? t("portalUnavailable"));
      }
      window.location.assign(result.url);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("billingUnavailable")
      );
      setPendingAction(null);
    }
  }

  return (
    <div className="space-y-4">
      {hasBillingAccount && canManage ? (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            disabled={pendingAction !== null}
            onClick={() => void openPortal()}
          >
            {pendingAction === "portal" ? (
              <Loader2 className="animate-spin" />
            ) : (
              <CreditCard />
            )}
            {t("manageBilling")}
          </Button>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {BILLING_PLANS.map((plan) => {
          const definition = getPlanDefinition(plan);
          const isCurrent = currentPlan === plan;
          const checkoutPending = pendingAction === `checkout:${plan}`;

          return (
            <Card
              key={plan}
              className={
                definition.recommended ? "border-primary shadow-sm" : ""
              }
            >
              <CardHeader className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-lg">
                    {tPricing(`plans.${plan}.name`)}
                  </CardTitle>
                  {definition.recommended ? (
                    <Badge>{tPricing("recommended")}</Badge>
                  ) : isCurrent ? (
                    <Badge variant="secondary">{t("currentPlan")}</Badge>
                  ) : null}
                </div>
                <p className="text-sm text-muted-foreground">
                  {tPricing(`plans.${plan}.description`)}
                </p>
                <p className="text-lg font-semibold">
                  {planPrices[plan]
                    ? formatPlanPrice(planPrices[plan])
                    : t("priceUnavailable")}
                </p>
              </CardHeader>

              <CardContent className="space-y-5">
                <ul className="space-y-2">
                  <li className="flex gap-2 text-sm font-medium">
                    <Check className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      {formatMemberLimit(
                        definition.limits.maxMembers,
                        tPricing
                      )}
                    </span>
                  </li>
                  <li className="flex gap-2 text-sm font-medium">
                    <Check className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      {formatTokenLimit(definition.limits.monthlyAiTokens, t)}
                    </span>
                  </li>
                  {BILLING_FEATURES.filter((feature) =>
                    definition.features.has(feature)
                  ).map((feature) => (
                    <li key={feature} className="flex gap-2 text-sm">
                      <Check className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{tPricing(`features.${feature}`)}</span>
                    </li>
                  ))}
                </ul>

                {canManage ? (
                  <Button
                    type="button"
                    className="w-full"
                    variant={definition.recommended ? "default" : "outline"}
                    disabled={
                      pendingAction !== null ||
                      (isCurrent && hasActiveSubscription)
                    }
                    onClick={() => {
                      if (hasActiveSubscription) {
                        void changePlan(plan);
                      } else {
                        void openCheckout(plan);
                      }
                    }}
                  >
                    {checkoutPending ? (
                      <Loader2 className="animate-spin" />
                    ) : null}
                    {isCurrent && hasActiveSubscription
                      ? t("currentPlan")
                      : hasActiveSubscription
                        ? t("changePlan")
                        : t("choosePlan", {
                            plan: tPricing(`plans.${plan}.name`),
                          })}
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t("adminOnly")}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
