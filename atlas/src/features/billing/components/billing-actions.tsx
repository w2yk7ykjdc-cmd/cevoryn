"use client";

import { Check, CreditCard, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BILLING_PLANS,
  getPlanDefinition,
  type BillingPlan,
} from "@/features/billing/config/plans";
import type { PlanPrice } from "@/server/services/paddle-catalog.service";

type PaddleEnvironment = "sandbox" | "production";

type PaddleCheckoutResponse = {
  priceId?: string;
  environment?: PaddleEnvironment;
  customerEmail?: string;
  customData?: { organizationId: string; plan: BillingPlan };
  error?: string;
};

type PaddleEvent = {
  name?: string;
  type?: string;
  code?: string;
  detail?: string;
  error?: {
    code?: string;
    detail?: string;
  };
};

type PaddleInstance = {
  Environment: { set(environment: "sandbox"): void };
  Initialize(options: {
    token: string;
    eventCallback?: (event: PaddleEvent) => void;
  }): void;
  Checkout: {
    open(options: {
      items: Array<{ priceId: string; quantity: number }>;
      customer?: { email: string };
      customData: Record<string, string>;
      settings?: { displayMode: "overlay"; theme: "light" };
    }): void;
  };
};

declare global {
  interface Window {
    Paddle?: PaddleInstance;
    __cevorynPaddleInitialized?: boolean;
  }
}

interface BillingActionsProps {
  currentPlan: BillingPlan;
  hasBillingAccount: boolean;
  hasActiveSubscription: boolean;
  canManage: boolean;
  planPrices: Partial<Record<BillingPlan, PlanPrice>>;
}

function formatPlanPrice(price: PlanPrice): string {
  const amount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: price.currencyCode,
    minimumFractionDigits: price.amount % 1 === 0 ? 0 : 2,
  }).format(price.amount);

  return `${amount}/${price.interval}`;
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

function getPaddleErrorMessage(event: PaddleEvent): string | null {
  const code = event.code ?? event.error?.code;
  const detail = event.detail ?? event.error?.detail;

  if (code === "transaction_default_checkout_url_not_set") {
    return "Paddle default payment link is not configured for this sandbox account.";
  }

  if (code === "invalid_client_token") {
    return "The Paddle client-side token is invalid or belongs to the wrong environment.";
  }

  return detail ?? (code ? `Paddle checkout error: ${code}` : null);
}

function handlePaddleEvent(event: PaddleEvent): void {
  if (event.name !== "checkout.error" && event.name !== "checkout.payment.error") {
    return;
  }

  console.error("[cevoryn:paddle] Checkout error", event);
  toast.error(getPaddleErrorMessage(event) ?? "Paddle checkout could not be opened.");
}

async function loadPaddle(environment: PaddleEnvironment): Promise<PaddleInstance> {
  const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN?.trim();
  if (!token) throw new Error("Paddle checkout is not configured.");

  if (environment === "sandbox" && !token.startsWith("test_")) {
    throw new Error("Paddle sandbox requires a test_ client-side token.");
  }

  if (environment === "production" && !token.startsWith("live_")) {
    throw new Error("Paddle production requires a live_ client-side token.");
  }

  if (!window.Paddle) {
    await new Promise<void>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(
        'script[data-cevoryn-paddle="true"]'
      );
      if (existing) {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error("Paddle.js failed to load.")), {
          once: true,
        });
        return;
      }

      const script = document.createElement("script");
      script.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
      script.async = true;
      script.dataset.cevorynPaddle = "true";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Paddle.js failed to load."));
      document.head.appendChild(script);
    });
  }

  if (!window.Paddle) throw new Error("Paddle.js is unavailable.");

  if (!window.__cevorynPaddleInitialized) {
    if (environment === "sandbox") window.Paddle.Environment.set("sandbox");
    window.Paddle.Initialize({ token, eventCallback: handlePaddleEvent });
    window.__cevorynPaddleInitialized = true;
  }

  return window.Paddle;
}

export function BillingActions({
  currentPlan,
  hasBillingAccount,
  hasActiveSubscription,
  canManage,
  planPrices,
}: BillingActionsProps) {
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  async function openCheckout(plan: BillingPlan) {
    const action = `checkout:${plan}`;
    try {
      setPendingAction(action);
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const result = (await response.json()) as PaddleCheckoutResponse;

      if (!response.ok || !result.priceId || !result.environment || !result.customData) {
        throw new Error(result.error ?? "Billing request failed.");
      }

      const paddle = await loadPaddle(result.environment);
      paddle.Checkout.open({
        items: [{ priceId: result.priceId, quantity: 1 }],
        customer: result.customerEmail ? { email: result.customerEmail } : undefined,
        customData: result.customData,
        settings: { displayMode: "overlay", theme: "light" },
      });
      setPendingAction(null);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Billing is unavailable."
      );
      setPendingAction(null);
    }
  }

  async function openPortal() {
    try {
      setPendingAction("portal");
      const response = await fetch("/api/billing/portal", { method: "POST" });
      const result = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !result.url) {
        throw new Error(result.error ?? "Billing portal is unavailable.");
      }
      window.location.assign(result.url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Billing is unavailable.");
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
            Manage billing
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
                <p className="text-lg font-semibold">
                  {planPrices[plan]
                    ? formatPlanPrice(planPrices[plan])
                    : "Price unavailable"}
                </p>
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
                        void openPortal();
                      } else {
                        void openCheckout(plan);
                      }
                    }}
                  >
                    {checkoutPending ? <Loader2 className="animate-spin" /> : null}
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
    </div>
  );
}
