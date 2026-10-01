import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { listAuditLogs } from "@/features/enterprise/audit/audit.service";
import { requireMembership, requireUser } from "@/lib/auth";
import { ROUTES } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { isRoleAtLeast } from "@/lib/rbac";

export const metadata: Metadata = { title: "Audit Log — CEVORYN" };

/**
 * Admin-only view of the enterprise audit trail (audit.service.ts). The
 * backend (recordAuditEvent/listAuditLogs, called from 6 real mutation
 * services) has existed since the audit trail was introduced, but had no
 * frontend consumer anywhere in the app - this page is that consumer. The
 * RBAC gate here matches the API route's own gate exactly
 * (isRoleAtLeast(role, "ADMIN")).
 */
export default async function AuditLogPage() {
  const user = await requireUser();
  const membership = await requireMembership(user.id);

  if (!isRoleAtLeast(membership.role, "ADMIN")) {
    redirect(ROUTES.DASHBOARD);
  }

  const t = await getTranslations("settings.auditLog");
  const locale = await getLocale();

  const logs = await listAuditLogs(membership.organizationId, { take: 100 });

  const actorIds = Array.from(
    new Set(
      logs
        .filter((log) => log.actorType === "USER" && log.actorId)
        .map((log) => log.actorId as string)
    )
  );
  const members = actorIds.length
    ? await prisma.member.findMany({
        where: { organizationId: membership.organizationId, userId: { in: actorIds } },
        select: { userId: true, displayName: true },
      })
    : [];
  const displayNameByUserId = new Map(
    members.map((member) => [member.userId, member.displayName])
  );

  const dateFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  function actorLabel(log: { actorType: string; actorId: string | null }) {
    if (log.actorType === "USER") {
      return (
        (log.actorId && displayNameByUserId.get(log.actorId)) ??
        t("unknownUser")
      );
    }
    return t(`actorTypes.${log.actorType}` as "actorTypes.SYSTEM");
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {logs.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t("empty")}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="divide-y p-0">
            {logs.map((log) => (
              <div
                key={log.id}
                className="flex flex-wrap items-start justify-between gap-2 p-4"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-medium">
                      {log.action}
                    </span>
                    <Badge variant="secondary" className="text-xs">
                      {log.resourceType}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("byActor", { actor: actorLabel(log) })}
                    {log.resourceId ? ` · ${log.resourceId}` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {dateFormatter.format(log.createdAt)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
