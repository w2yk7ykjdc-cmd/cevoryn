import { ArrowRight, Check } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  BILLING_FEATURES,
  BILLING_PLANS,
  getPlanDefinition,
  type BillingFeature,
} from "@/features/billing/config/plans";
import { BRAND } from "@/lib/brand";
import { ROUTES } from "@/lib/constants";
import { getPlanPrices, type PlanPrice } from "@/server/services/paddle-catalog.service";

export const metadata: Metadata = { title: "Pricing — CEVORYN" };

const FEATURE_LABELS: Record<BillingFeature, string> = {
  CHAT: "AI chat",
  DASHBOARD: "Dashboard",
  DECISION_SUPPORT: "Decision support",
  BRAIN: "CEVORYN Brain",
  ADVANCED_REPORTS: "Advanced reports and briefs",
  TEAM: "Team collaboration",
  ADVANCED_RBAC: "Advanced RBAC",
  PRIORITY_SUPPORT: "Priority support",
};

function formatPlanPrice(price: PlanPrice): string {
  const amount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: price.currencyCode,
    minimumFractionDigits: price.amount % 1 === 0 ? 0 : 2,
  }).format(price.amount);

  return `${amount}/${price.interval}`;
}

function formatMemberLimit(maxMembers: number): string {
  return maxMembers === 1 ? "1 team member" : `Up to ${maxMembers} team members`;
}

export default async function PricingPage() {
  const planPrices = await getPlanPrices();

  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-16">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-balance text-4xl font-bold tracking-tight sm:text-5xl">
          Pricing
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Simple, transparent plans for teams of 2–20. Cancel anytime.
        </p>
      </div>

      <div className="mx-auto mt-12 grid max-w-5xl gap-6 sm:grid-cols-3">
        {BILLING_PLANS.map((plan) => {
          const definition = getPlanDefinition(plan);
          const price = planPrices[plan];

          return (
            <div
              key={plan}
              className="flex flex-col rounded-lg border p-6"
              data-recommended={definition.recommended || undefined}
            >
              {definition.recommended && (
                <span className="mb-3 w-fit rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
                  Recommended
                </span>
              )}
              <h2 className="text-lg font-semibold">{definition.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {definition.description}
              </p>
              <p className="mt-4 text-3xl font-bold tracking-tight">
                {price ? formatPlanPrice(price) : "Contact us"}
              </p>

              <ul className="mt-6 flex-1 space-y-2 text-left text-sm">
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  {formatMemberLimit(definition.limits.maxMembers)}
                </li>
                {BILLING_FEATURES.filter((feature) =>
                  definition.features.has(feature)
                ).map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    {FEATURE_LABELS[feature]}
                  </li>
                ))}
              </ul>

              <Link href={ROUTES.SIGNUP} className="mt-6">
                <Button className="w-full" variant={definition.recommended ? "default" : "outline"}>
                  Get started
                  <ArrowRight />
                </Button>
              </Link>
            </div>
          );
        })}
      </div>

      <footer className="mt-16 flex flex-col items-center gap-3 text-sm text-muted-foreground">
        <div className="flex gap-4">
          <Link className="hover:text-foreground" href={ROUTES.TERMS}>
            Terms
          </Link>
          <Link className="hover:text-foreground" href={ROUTES.PRIVACY}>
            Privacy
          </Link>
          <Link className="hover:text-foreground" href={ROUTES.REFUNDS}>
            Refunds
          </Link>
        </div>
        <p className="text-xs">
          © {new Date().getFullYear()} {BRAND.name}. All rights reserved.
        </p>
      </footer>
    </main>
  );
}
