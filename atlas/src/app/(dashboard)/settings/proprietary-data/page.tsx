import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { Card, CardContent } from "@/components/ui/card";
import { hasFeature } from "@/features/billing/config/plans";
import { listProprietaryDataRecords } from "@/features/enterprise/proprietary-data/proprietary-data.service";
import { requireMembership, requireUser } from "@/lib/auth";
import { ROUTES } from "@/lib/constants";
import { hasPermission } from "@/lib/rbac";
import { getOrganizationPlan } from "@/server/services/entitlement.service";

import { ProprietaryDataManager } from "./proprietary-data-manager";

export const metadata: Metadata = { title: "Proprietary Data — CEVORYN" };

export default async function ProprietaryDataPage() {
  const user = await requireUser();
  const membership = await requireMembership(user.id);

  if (!hasPermission(membership.role, "radar:read")) {
    redirect(ROUTES.DASHBOARD);
  }

  const t = await getTranslations("settings.proprietaryData");
  const plan = await getOrganizationPlan(membership.organizationId);
  const radarEnabled = hasFeature(plan, "RADAR");
  const canManage =
    hasPermission(membership.role, "radar:manage") && radarEnabled;

  const records = radarEnabled
    ? await listProprietaryDataRecords(membership.organizationId)
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
        <ProprietaryDataManager
          canManage={canManage}
          initialRecords={records.map((record) => ({
            id: record.id,
            sourceKind: record.sourceKind,
            title: record.title,
            content: record.content,
            url: record.url,
            tags: record.tags,
            updatedAt: record.updatedAt.toISOString(),
          }))}
        />
      )}
    </div>
  );
}
