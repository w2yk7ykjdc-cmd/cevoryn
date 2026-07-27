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

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireMembership, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/rbac";

export const metadata: Metadata = { title: "Product Analytics — CEVORYN" };
export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const user = await requireUser();
  const membership = await requireMembership(user.id);

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
        <h1 className="text-2xl font-bold tracking-tight">Product Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Real usage and execution signals for the last 30 days.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          icon={Users}
          label="Active users"
          value={`${activeMembers.length}/${members}`}
          detail={`${activeUserRate}% of team`}
        />
        <MetricCard
          icon={MessageSquare}
          label="User messages"
          value={messages30d}
          detail={`${messages7d} in 7 days`}
        />
        <MetricCard
          icon={Sparkles}
          label="Briefs generated"
          value={briefs30d}
          detail={`${conversations30d} conversations`}
        />
        <MetricCard
          icon={CheckCircle2}
          label="Actions approved"
          value={approvedActions30d}
          detail={`${actionCompletionRate}% completion`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="h-4 w-4" />
            Execution funnel
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <FunnelStep
            label="Open insights"
            value={openInsights}
            description="Signals waiting for review"
          />
          <FunnelStep
            label="Insights acted on"
            value={completedInsights30d}
            description="Converted into action"
          />
          <FunnelStep
            label="Decisions progressed"
            value={progressedDecisions30d}
            description="Accepted or executed"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Usage momentum</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FunnelStep
            label="7-day conversations"
            value={conversations7d}
            description="New work sessions this week"
          />
          <FunnelStep
            label="30-day conversations"
            value={conversations30d}
            description="New work sessions this month"
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
