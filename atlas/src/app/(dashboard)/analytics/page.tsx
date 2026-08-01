import {
  ActionStatus,
  DecisionStatus,
  InsightStatus,
  MessageRole,
} from "@prisma/client";
import {
  BarChart3,
  CheckCircle2,
  MessageSquare,
  Sparkles,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireMembership, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/rbac";

export const metadata: Metadata = { title: "Product Analytics — CEVORYN" };
export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const user = await requireUser();
  const membership = await requireMembership(user.id);
  const t = await getTranslations("analytics");

  if (!hasPermission(membership.role, "analytics:read")) {
    redirect("/dashboard");
  }

  const organizationId = membership.organizationId;
  const now = new Date();
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [
    members,
    activeMembers,
    conversations7d,
    conversations30d,
    messages7d,
    messages30d,
    briefs30d,
    approvedActions30d,
    completedInsights30d,
    progressedDecisions30d,
    pendingActions,
    openInsights,
  ] = await Promise.all([
    prisma.member.count({ where: { organizationId } }),
    prisma.conversation.findMany({
      where: { organizationId, updatedAt: { gte: thirtyDaysAgo } },
      distinct: ["createdById"],
      select: { createdById: true },
    }),
    prisma.conversation.count({
      where: { organizationId, createdAt: { gte: sevenDaysAgo } },
    }),
    prisma.conversation.count({
      where: { organizationId, createdAt: { gte: thirtyDaysAgo } },
    }),
    prisma.message.count({
      where: {
        conversation: { organizationId },
        createdAt: { gte: sevenDaysAgo },
        role: MessageRole.USER,
      },
    }),
    prisma.message.count({
      where: {
        conversation: { organizationId },
        createdAt: { gte: thirtyDaysAgo },
        role: MessageRole.USER,
      },
    }),
    prisma.brief.count({
      where: { organizationId, createdAt: { gte: thirtyDaysAgo } },
    }),
    prisma.preparedAction.count({
      where: {
        organizationId,
        status: ActionStatus.APPROVED,
        updatedAt: { gte: thirtyDaysAgo },
      },
    }),
    prisma.insight.count({
      where: {
        organizationId,
        status: InsightStatus.ACTED_ON,
        updatedAt: { gte: thirtyDaysAgo },
      },
    }),
    prisma.decision.count({
      where: {
        organizationId,
        status: {
          in: [
            DecisionStatus.ACCEPTED,
            DecisionStatus.EXECUTED,
            DecisionStatus.COMPLETED,
            DecisionStatus.SUCCESSFUL,
          ],
        },
        updatedAt: { gte: thirtyDaysAgo },
      },
    }),
    prisma.preparedAction.count({
      where: { organizationId, status: ActionStatus.PENDING },
    }),
    prisma.insight.count({
      where: { organizationId, status: InsightStatus.NEW },
    }),
  ]);

  const activeUserRate =
    members > 0 ? Math.round((activeMembers.length / members) * 100) : 0;
  const actionTotal = approvedActions30d + pendingActions;
  const actionCompletionRate =
    actionTotal > 0 ? Math.round((approvedActions30d / actionTotal) * 100) : 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          icon={Users}
          label={t("activeUsers")}
          value={`${activeMembers.length}/${members}`}
          detail={t("ofTeam", { percent: activeUserRate })}
        />
        <MetricCard
          icon={MessageSquare}
          label={t("userMessages")}
          value={messages30d}
          detail={t("inDays", { count: messages7d })}
        />
        <MetricCard
          icon={Sparkles}
          label={t("briefsGenerated")}
          value={briefs30d}
          detail={t("conversationsCount", { count: conversations30d })}
        />
        <MetricCard
          icon={CheckCircle2}
          label={t("actionsApproved")}
          value={approvedActions30d}
          detail={t("completionRate", { percent: actionCompletionRate })}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="h-4 w-4" />
            {t("executionFunnel")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <FunnelStep
            label={t("openInsights")}
            value={openInsights}
            description={t("openInsightsDescription")}
          />
          <FunnelStep
            label={t("insightsActedOn")}
            value={completedInsights30d}
            description={t("insightsActedOnDescription")}
          />
          <FunnelStep
            label={t("decisionsProgressed")}
            value={progressedDecisions30d}
            description={t("decisionsProgressedDescription")}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("usageMomentum")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FunnelStep
            label={t("conversations7d")}
            value={conversations7d}
            description={t("conversations7dDescription")}
          />
          <FunnelStep
            label={t("conversations30d")}
            value={conversations30d}
            description={t("conversations30dDescription")}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <p className="text-2xl font-bold">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function FunnelStep({
  label,
  value,
  description,
}: {
  label: string;
  value: number;
  description: string;
}) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-2xl font-bold">{value}</p>
      <p className="mt-1 text-sm font-medium">{label}</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
