import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { Card, CardContent } from "@/components/ui/card";
import { hasFeature } from "@/features/billing/config/plans";
import { listWatchedEntities } from "@/features/radar/entities/entity.service";
import { requireMembership, requireUser } from "@/lib/auth";
import { ROUTES } from "@/lib/constants";
import { hasPermission } from "@/lib/rbac";
import { getOrganizationPlan } from "@/server/services/entitlement.service";

import { WatchlistManager } from "./watchlist-manager";

export const metadata: Metadata = { title: "Watchlist — CEVORYN" };

export default async function WatchlistPage() {
  const user = await requireUser();
  const membership = await requireMembership(user.id);

  if (!hasPermission(membership.role, "radar:read")) {
    redirect(ROUTES.DASHBOARD);
  }

  const t = await getTranslations("radar.watchlist_page");
  const plan = await getOrganizationPlan(membership.organizationId);
  const radarEnabled = hasFeature(plan, "RADAR");
  const canManage =
    hasPermission(membership.role, "radar:manage") && radarEnabled;

  const entities = radarEnabled
    ? await listWatchedEntities(membership.organizationId)
    : [];

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {!radarEnabled ? (
        <Card className="border-amber-500/30">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            {t("requiresPlan")}
          </CardContent>
        </Card>
      ) : (
        <WatchlistManager
          canManage={canManage}
          initialEntities={entities.map((entity) => ({
            id: entity.id,
            name: entity.name,
            domain: entity.domain,
            watchReason: entity.watchReason,
          }))}
        />
      )}
    </div>
  );
}
