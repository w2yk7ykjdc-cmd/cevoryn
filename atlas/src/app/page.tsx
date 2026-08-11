import {
  ArrowRight,
  CheckSquare,
  Gauge,
  MessageSquare,
  Scale,
  Sunrise,
  Users,
} from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";
import { ROUTES } from "@/lib/constants";

const FEATURE_ICONS = [
  { key: "chat", icon: MessageSquare },
  { key: "decisions", icon: Scale },
  { key: "actions", icon: CheckSquare },
  { key: "brief", icon: Sunrise },
  { key: "pulse", icon: Gauge },
  { key: "team", icon: Users },
] as const;

export default async function HomePage() {
  const t = await getTranslations("landing");
  const tNav = await getTranslations("nav");

  return (
    <>
      <header className="mx-auto flex w-full max-w-4xl items-center justify-between px-4 py-6">
        <span className="font-semibold tracking-tight">{BRAND.name}</span>
        <Link
          className="text-sm text-muted-foreground hover:text-foreground"
          href={ROUTES.PRICING}
        >
          {tNav("pricing")}
        </Link>
      </header>
      <main className="flex min-h-screen flex-col items-center px-4 py-16">
        <div className="mx-auto max-w-2xl text-center">
          <div className="mb-6 inline-flex items-center rounded-full border px-4 py-1.5 text-sm text-muted-foreground">
            {t("tagline")}
          </div>
          <h1 className="text-balance text-4xl font-bold tracking-tight sm:text-5xl">
            {BRAND.name}
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">{t("subtitle")}</p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link href={ROUTES.SIGNUP}>
              <Button size="lg">
                {t("getStarted")}
                <ArrowRight />
              </Button>
            </Link>
            <Link href={ROUTES.LOGIN}>
              <Button variant="outline" size="lg">
                {t("signIn")}
              </Button>
            </Link>
          </div>
        </div>

        <div className="mx-auto mt-20 grid max-w-4xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURE_ICONS.map((feature) => (
            <div key={feature.key} className="rounded-lg border p-5 text-left">
              <feature.icon className="h-6 w-6 text-primary" />
              <h2 className="mt-3 font-semibold">
                {t(`features.${feature.key}.title`)}
              </h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {t(`features.${feature.key}.description`)}
              </p>
            </div>
          ))}
        </div>

        <footer className="mt-16 flex flex-col items-center gap-3 text-sm text-muted-foreground">
          <div className="flex gap-4">
            <Link className="hover:text-foreground" href={ROUTES.PRICING}>
              {tNav("pricing")}
            </Link>
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
            {t("copyright", {
              year: new Date().getFullYear(),
              name: BRAND.name,
            })}
          </p>
        </footer>
      </main>
    </>
  );
}
