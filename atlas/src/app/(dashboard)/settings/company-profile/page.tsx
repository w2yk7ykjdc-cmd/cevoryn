import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { Card, CardContent } from "@/components/ui/card";
import { hasFeature } from "@/features/billing/config/plans";
import { getCompanyProfile } from "@/features/radar/profile/company-profile.service";
import { requireMembership, requireUser } from "@/lib/auth";
import { ROUTES } from "@/lib/constants";
import { hasPermission } from "@/lib/rbac";
import { getOrganizationPlan } from "@/server/services/entitlement.service";

import { CompanyProfileForm } from "./company-profile-form";

export const metadata: Metadata = { title: "Company Profile — CEVORYN" };

export default async function CompanyProfilePage() {
  const user = await requireUser();
  const membership = await requireMembership(user.id);

  if (!hasPermission(membership.role, "radar:read")) {
    redirect(ROUTES.DASHBOARD);
  }

  const [plan, profile] = await Promise.all([
    getOrganizationPlan(membership.organizationId),
    getCompanyProfile(membership.organizationId),
  ]);

  const t = await getTranslations("settings.companyProfile");
  const canManage = hasPermission(membership.role, "radar:manage");
  const radarEnabled = hasFeature(plan, "RADAR");

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
      ) : null}

      <Card>
        <CardContent className="pt-6">
          <CompanyProfileForm
            canManage={canManage && radarEnabled}
            initialProfile={{
              description: profile?.description ?? "",
              industry: profile?.industry ?? "",
              products: profile?.products ?? [],
              services: profile?.services ?? [],
              targetMarkets: profile?.targetMarkets ?? [],
              targetCustomers: profile?.targetCustomers ?? "",
              idealCustomerProfile: profile?.idealCustomerProfile ?? "",
              geographies: profile?.geographies ?? [],
              competitors: profile?.competitors ?? [],
              suppliers: profile?.suppliers ?? [],
              businessModel: profile?.businessModel ?? "",
              averageDealSize: profile?.averageDealSize ?? null,
              strategicGoals: profile?.strategicGoals ?? [],
              strategicPriorities: profile?.strategicPriorities ?? [],
              capabilities: profile?.capabilities ?? [],
              constraints: profile?.constraints ?? [],
              knownCustomers: profile?.knownCustomers ?? [],
              growthObjectives: profile?.growthObjectives ?? [],
              preferredOpportunities: profile?.preferredOpportunities ?? [],
              excludedOpportunities: profile?.excludedOpportunities ?? [],
              companySize: profile?.companySize ?? "",
              revenueRange: profile?.revenueRange ?? "",
              preferredCurrency: profile?.preferredCurrency ?? "EUR",
              customContext: profile?.customContext ?? "",
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
