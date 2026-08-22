import { Building2, Mail, ShieldCheck, UserRound } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { signOutAction } from "@/features/auth/actions/auth";
import { getMembership, requireUser } from "@/lib/auth";

import { DisplayNameForm } from "./display-name-form";
import { EmailChangeForm } from "./email-change-form";

function formatDisplayName(name: string): string {
  const normalized = name.trim().replace(/\s+/g, " ");

  return normalized
    .split(" ")
    .map((part) => {
      const lower = part.toLocaleLowerCase("tr-TR");
      return lower.charAt(0).toLocaleUpperCase("tr-TR") + lower.slice(1);
    })
    .join(" ");
}

export default async function ProfilePage() {
  const user = await requireUser();
  const membership = await getMembership(user.id);
  const t = await getTranslations("profile");

  if (!membership) {
    return null;
  }

  const displayName = formatDisplayName(membership.displayName);
  const initials = displayName
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 pb-40">
      <div>
        <p className="text-sm font-medium text-muted-foreground">
          {t("accountLabel")}
        </p>
        <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <Card>
        <CardContent className="flex items-center gap-4 p-6">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border bg-muted text-xl font-bold">
            {initials}
          </div>
          <div className="min-w-0">
            <p className="truncate text-xl font-semibold">{displayName}</p>
            <p className="truncate text-sm text-muted-foreground">
              {user.email}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("accountDetails")}</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          <div className="flex items-start gap-3 py-4 first:pt-0">
            <UserRound className="mt-2 h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("name")}
              </p>
              <DisplayNameForm initialName={displayName} />
            </div>
          </div>

          <div className="flex items-start gap-3 py-4">
            <Mail className="mt-2 h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("email")}
              </p>
              <EmailChangeForm initialEmail={user.email} />
            </div>
          </div>

          <div className="flex items-center gap-3 py-4">
            <Building2 className="h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("workspace")}
              </p>
              <p className="truncate font-medium">
                {membership.organizationName}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 py-4 last:pb-0">
            <ShieldCheck className="h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("role")}
              </p>
              <p className="font-medium">{t(`roles.${membership.role}`)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-10">
        <CardHeader>
          <CardTitle>{t("session")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={signOutAction}>
            <Button
              type="submit"
              variant="destructive"
              className="w-full sm:w-auto"
            >
              {t("signOut")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
