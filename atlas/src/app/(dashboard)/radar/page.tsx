import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { Card, CardContent } from "@/components/ui/card";
import { hasFeature } from "@/features/billing/config/plans";
import { listEvents } from "@/features/radar/events/event.service";
import { listOpportunities } from "@/features/radar/opportunities/opportunity.service";
import { requireMembership, requireUser } from "@/lib/auth";
import { ROUTES } from "@/lib/constants";
import { hasPermission } from "@/lib/rbac";
import { getOrganizationPlan } from "@/server/services/entitlement.service";

import { RadarFeed } from "./radar-feed";

export const metadata: Metadata = { title: "Radar — CEVORYN" };

export default async function RadarPage() {
  const user = await requireUser();
  const membership = await requireMembership(user.id);

  if (!hasPermission(membership.role, "radar:read")) {
    redirect(ROUTES.DASHBOARD);
  }

  const t = await getTranslations("radar");
  const plan = await getOrganizationPlan(membership.organizationId);
  const radarEnabled = hasFeature(plan, "RADAR");

  const [opportunities, threats, events] = radarEnabled
    ? await Promise.all([
        listOpportunities(membership.organizationId, {
          polarity: "OPPORTUNITY",
          take: 20,
        }),
        listOpportunities(membership.organizationId, {
          polarity: "THREAT",
          take: 20,
        }),
        listEvents(membership.organizationId, { take: 15 }),
      ])
    : [[], [], []];

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-8">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
      </div>

      {!radarEnabled ? (
        <Card className="border-amber-500/30">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            {t("requiresPlan")}
          </CardContent>
        </Card>
      ) : (
        <RadarFeed
          canManage={hasPermission(membership.role, "radar:manage")}
          opportunities={opportunities}
          threats={threats}
          events={events}
        />
      )}
    </div>
  );
}
