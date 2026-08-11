import { ArrowRight, Check } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import {
  BILLING_FEATURES,
  BILLING_PLANS,
  getPlanDefinition,
  type BillingFeature,
} from "@/features/billing/config/plans";
import { BRAND } from "@/lib/brand";
import { ROUTES } from "@/lib/constants";
import {
  getPlanPrices,
  type PlanPrice,
} from "@/server/services/paddle-catalog.service";

export const metadata: Metadata = { title: "Pricing — CEVORYN" };

function formatPlanPrice(price: PlanPrice, perMonthLabel: string): string {
  const amount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: price.currencyCode,
    minimumFractionDigits: price.amount % 1 === 0 ? 0 : 2,
  }).format(price.amount);

  return price.interval === "month"
    ? `${amount}${perMonthLabel}`
    : `${amount}/${price.interval}`;
}

export default async function PricingPage() {
  const planPrices = await getPlanPrices();
  const t = await getTranslations("pricing");
  const tNav = await getTranslations("nav");
  const tLanding = await getTranslations("landing");

  return (
    <>
      <header className="mx-auto flex w-full max-w-4xl items-center justify-between px-4 py-6">
        <Logo />
        <Link
          className="text-sm text-muted-foreground hover:text-foreground"
          href={ROUTES.LOGIN}
        >
          {tLanding("signIn")}
        </Link>
      </header>
      <main className="flex min-h-screen flex-col items-center px-4 py-16">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-balance text-4xl font-bold tracking-tight sm:text-5xl">
            {t("title")}
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">{t("subtitle")}</p>
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
                    {t("recommended")}
                  </span>
                )}
                <h2 className="text-lg font-semibold">
                  {t(`plans.${plan}.name`)}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t(`plans.${plan}.description`)}
                </p>
                <p className="mt-4 text-3xl font-bold tracking-tight">
                  {price
                    ? formatPlanPrice(price, t("perMonth"))
                    : t("contactUs")}
                </p>

                <ul className="mt-6 flex-1 space-y-2 text-left text-sm">
                  <li className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    {definition.limits.maxMembers === 1
                      ? t("memberLimitOne")
                      : t("memberLimit", {
                          count: definition.limits.maxMembers,
                        })}
                  </li>
                  {BILLING_FEATURES.filter((feature) =>
                    definition.features.has(feature)
                  ).map((feature: BillingFeature) => (
                    <li key={feature} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      {t(`features.${feature}`)}
                    </li>
                  ))}
                </ul>

                <Link href={ROUTES.SIGNUP} className="mt-6">
                  <Button
                    className="w-full"
                    variant={definition.recommended ? "default" : "outline"}
                  >
                    {tLanding("getStarted")}
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
              {tNav("terms")}
            </Link>
            <Link className="hover:text-foreground" href={ROUTES.PRIVACY}>
              {tNav("privacy")}
            </Link>
            <Link className="hover:text-foreground" href={ROUTES.REFUNDS}>
              {tNav("refunds")}
            </Link>
          </div>
          <p className="text-xs">
            {tLanding("copyright", {
              year: new Date().getFullYear(),
              name: BRAND.name,
            })}
          </p>
        </footer>
      </main>
    </>
  );
}
