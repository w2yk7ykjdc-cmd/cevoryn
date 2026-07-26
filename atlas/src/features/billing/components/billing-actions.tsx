"use client";

import { Check, CreditCard, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IyzicoCheckoutDialog } from "@/features/billing/components/iyzico-checkout-dialog";
import {
  BILLING_PLANS,
  getPlanDefinition,
  type BillingPlan,
} from "@/features/billing/config/plans";

interface BillingActionsProps {
  currentPlan: BillingPlan;
  hasBillingAccount: boolean;
  hasActiveSubscription: boolean;
  canManage: boolean;
}

interface BillingApiResponse {
  url?: string;
  error?: string;
}

const featureLabels: Record<BillingPlan, string[]> = {
  STARTER: [
    "1 team member",
    "250K monthly AI tokens",
    "Core chat and dashboard",
    "Basic decision support",
  ],
  PROFESSIONAL: [
    "Up to 5 team members",
    "1.5M monthly AI tokens",
    "CEVORYN Brain",
    "Advanced reports and briefs",
  ],
  BUSINESS: [
    "Up to 20 team members",
    "5M monthly AI tokens",
    "Advanced RBAC",
    "Priority support",
  ],
};

export function BillingActions({
  currentPlan,
  hasBillingAccount,
  hasActiveSubscription,
  canManage,
}: BillingActionsProps) {
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<BillingPlan | null>(null);

  async function redirectFromBillingRequest(endpoint: string) {
    try {
      setPendingAction(endpoint);
      const response = await fetch(endpoint, { method: "POST" });
      const result = (await response.json()) as BillingApiResponse;

      if (!response.ok || !result.url) {
        throw new Error(result.error ?? "Billing request failed.");
      }

      window.location.assign(result.url);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Billing is unavailable."
      );
      setPendingAction(null);
    }
  }

  const managePending = pendingAction === "/api/billing/portal";

  return (
    <div className="space-y-4">
      {hasBillingAccount && canManage ? (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            disabled={pendingAction !== null}
            onClick={() => void redirectFromBillingRequest("/api/billing/portal")}
          >
            {managePending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <CreditCard />
            )}
            Manage billing
          </Button>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {BILLING_PLANS.map((plan) => {
          const definition = getPlanDefinition(plan);
          const isCurrent = currentPlan === plan;

          return (
            <Card
              key={plan}
              className={definition.recommended ? "border-primary shadow-sm" : ""}
            >
              <CardHeader className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-lg">{definition.name}</CardTitle>
                  {definition.recommended ? (
                    <Badge>Recommended</Badge>
                  ) : isCurrent ? (
                    <Badge variant="secondary">Current plan</Badge>
                  ) : null}
                </div>
                <p className="text-sm text-muted-foreground">
                  {definition.description}
                </p>
                <p className="text-sm font-medium">Monthly subscription</p>
              </CardHeader>

              <CardContent className="space-y-5">
                <ul className="space-y-2">
                  {featureLabels[plan].map((feature) => (
                    <li key={feature} className="flex gap-2 text-sm">
                      <Check className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                {canManage ? (
                  <Button
                    type="button"
                    className="w-full"
                    variant={definition.recommended ? "default" : "outline"}
                    disabled={pendingAction !== null || (isCurrent && hasActiveSubscription)}
                    onClick={() => {
                      if (hasActiveSubscription) {
                        void redirectFromBillingRequest("/api/billing/portal");
                        return;
                      }

                      setSelectedPlan(plan);
                    }}
                  >
                    {isCurrent && hasActiveSubscription
                      ? "Current plan"
                      : hasActiveSubscription
                        ? "Change plan"
                        : `Choose ${definition.name}`}
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Ask an organization owner or admin to manage this plan.
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <IyzicoCheckoutDialog
        plan={selectedPlan}
        open={selectedPlan !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedPlan(null);
        }}
      />
    </div>
  );
}
