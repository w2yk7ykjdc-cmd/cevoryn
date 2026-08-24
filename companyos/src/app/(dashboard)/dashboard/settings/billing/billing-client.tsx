"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { PlanTier, SubscriptionStatus } from "@prisma/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  cancelSubscriptionAction,
  openBillingPortalAction,
  startCheckoutAction,
} from "@/app/(dashboard)/dashboard/settings/billing/actions";

type UsageMetricName = "ai_tokens" | "agent_run";

type PlanInfo = {
  tier: PlanTier;
  name: string;
  monthlyPriceCents: number;
  aiTokenLimit: number;
  agentRunLimit: number;
  seatLimit: number | null;
};

type UsageInfo = { metric: UsageMetricName; used: number; limit: number };

type SubscriptionInfo = {
  status: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date;
  plan: { tier: PlanTier; name: string; monthlyPriceCents: number };
};

const STATUS_VARIANT: Record<SubscriptionStatus, "outline" | "secondary" | "default" | "destructive"> = {
  trialing: "secondary",
  active: "default",
  past_due: "destructive",
  canceled: "outline",
  incomplete: "outline",
};

const METRIC_LABEL: Record<UsageMetricName, string> = {
  ai_tokens: "AI tokens",
  agent_run: "Agent runs",
};

function formatPrice(cents: number): string {
  return cents === 0 ? "Free" : `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}/mo`;
}

export function BillingClient({
  billingConfigured,
  subscription,
  usage,
  plans,
}: {
  billingConfigured: boolean;
  subscription: SubscriptionInfo;
  usage: UsageInfo[];
  plans: PlanInfo[];
}) {
  const [pending, setPending] = useState<string | null>(null);

  async function handleCheckout(tier: "pro" | "enterprise") {
    setPending(tier);
    try {
      const result = await startCheckoutAction(tier);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      window.location.href = result.url;
    } finally {
      setPending(null);
    }
  }

  async function handlePortal() {
    setPending("portal");
    try {
      const result = await openBillingPortalAction();
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      window.location.href = result.url;
    } finally {
      setPending(null);
    }
  }

  async function handleCancel() {
    setPending("cancel");
    try {
      const result = await cancelSubscriptionAction();
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Cancellation requested — you'll keep access until the end of the current period.");
    } finally {
      setPending(null);
    }
  }

  const nextTier = subscription.plan.tier === "free" ? "pro" : subscription.plan.tier === "pro" ? "enterprise" : null;

  return (
    <div className="flex flex-col gap-6">
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {subscription.plan.name}
            <Badge variant={STATUS_VARIANT[subscription.status]} className="capitalize">
              {subscription.status.replace("_", " ")}
            </Badge>
          </CardTitle>
          <CardDescription>
            {formatPrice(subscription.plan.monthlyPriceCents)}
            {" · "}
            {subscription.cancelAtPeriodEnd ? "Cancels" : "Renews"} {subscription.currentPeriodEnd.toLocaleDateString()}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            {usage.map((u) => {
              const pct = u.limit > 0 ? Math.min(100, Math.round((u.used / u.limit) * 100)) : 0;
              return (
                <div key={u.metric}>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{METRIC_LABEL[u.metric]}</span>
                    <span>
                      {u.used.toLocaleString()} / {u.limit.toLocaleString()}
                    </span>
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn("h-full rounded-full", pct >= 100 ? "bg-destructive" : "bg-primary")}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {!billingConfigured && (
            <p className="text-xs text-muted-foreground">
              Billing isn&apos;t configured in this environment (no Stripe key set) — plan upgrades are disabled.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {billingConfigured && nextTier && (
              <Button size="sm" disabled={pending !== null} onClick={() => handleCheckout(nextTier)}>
                Upgrade to {nextTier === "pro" ? "Pro" : "Enterprise"}
              </Button>
            )}
            {billingConfigured && subscription.plan.tier !== "free" && (
              <Button size="sm" variant="outline" disabled={pending !== null} onClick={handlePortal}>
                Manage billing
              </Button>
            )}
            {billingConfigured && subscription.plan.tier !== "free" && !subscription.cancelAtPeriodEnd && (
              <Button size="sm" variant="outline" disabled={pending !== null} onClick={handleCancel}>
                Cancel plan
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="text-base">Plans</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {plans.map((plan, index) => (
            <div key={plan.tier}>
              {index > 0 && <Separator className="my-3" />}
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">{plan.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {plan.aiTokenLimit.toLocaleString()} AI tokens · {plan.agentRunLimit.toLocaleString()} agent runs/mo
                    {plan.seatLimit ? ` · ${plan.seatLimit} seats` : " · unlimited seats"}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-medium">{formatPrice(plan.monthlyPriceCents)}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
