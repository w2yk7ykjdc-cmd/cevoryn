import { headers as nextHeaders } from "next/headers";
import Link from "next/link";
import type { AgentRunStatus } from "@prisma/client";
import { requireActiveOrganization } from "@/server/auth/session";
import { auth } from "@/server/auth/auth";
import { prisma } from "@/server/db/client";
import { listAgentRuns } from "@/server/ai/agent/executor";
import { getSubscriptionForOrg } from "@/server/billing/subscription";
import { getUsageSummary } from "@/server/billing/usage";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const AGENT_STATUS_VARIANT: Record<AgentRunStatus, "outline" | "secondary" | "default" | "destructive"> = {
  planning: "outline",
  running: "secondary",
  waiting_approval: "secondary",
  completed: "default",
  failed: "destructive",
  rejected: "destructive",
};

export default async function DashboardOverviewPage() {
  const { organization } = await requireActiveOrganization();
  const headers = await nextHeaders();

  const [
    memberCount,
    companyCount,
    contactCount,
    openLeads,
    openTaskCount,
    overdueTaskCount,
    agentPermitted,
    billingPermitted,
  ] = await Promise.all([
    prisma.member.count({ where: { organizationId: organization.id } }),
    prisma.company.count({ where: { organizationId: organization.id, deletedAt: null } }),
    prisma.contact.count({ where: { organizationId: organization.id, deletedAt: null } }),
    prisma.lead.findMany({
      where: { organizationId: organization.id, deletedAt: null, stage: { isWon: false, isLost: false } },
      select: { value: true },
    }),
    prisma.task.count({
      where: { organizationId: organization.id, deletedAt: null, status: { notIn: ["done", "cancelled"] } },
    }),
    prisma.task.count({
      where: {
        organizationId: organization.id,
        deletedAt: null,
        status: { notIn: ["done", "cancelled"] },
        dueDate: { lt: new Date() },
      },
    }),
    auth.api.hasPermission({ headers, body: { organizationId: organization.id, permissions: { aiConversation: ["create"] } } }),
    auth.api.hasPermission({ headers, body: { organizationId: organization.id, permissions: { billing: ["view"] } } }),
  ]);

  const pipelineValue = openLeads.reduce((sum, lead) => sum + Number(lead.value), 0);
  const canUseAgent = agentPermitted.success;
  const canViewBilling = billingPermitted.success;

  const [recentAgentRuns, subscription, usage] = await Promise.all([
    canUseAgent ? listAgentRuns(organization.id) : Promise.resolve([]),
    canViewBilling ? getSubscriptionForOrg(organization.id) : Promise.resolve(null),
    canViewBilling ? getUsageSummary(organization.id) : Promise.resolve(null),
  ]);

  const stats = [
    { label: "Members", value: memberCount, href: "/dashboard/members" },
    { label: "Companies", value: companyCount, href: "/dashboard/companies" },
    { label: "Contacts", value: contactCount, href: "/dashboard/contacts" },
    { label: "Open leads", value: openLeads.length, href: "/dashboard/leads" },
    { label: "Pipeline value", value: `$${pipelineValue.toLocaleString()}`, href: "/dashboard/leads" },
    { label: "Open tasks", value: openTaskCount, href: "/dashboard/tasks" },
    { label: "Overdue tasks", value: overdueTaskCount, href: "/dashboard/tasks" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{organization.name}</h1>
        <p className="text-sm text-muted-foreground">Workspace overview</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map((stat) => (
          <Link key={stat.label} href={stat.href}>
            <Card className="transition-colors hover:bg-accent">
              <CardHeader>
                <CardDescription>{stat.label}</CardDescription>
                <CardTitle className="text-2xl">{stat.value}</CardTitle>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>

      {(canUseAgent || canViewBilling) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {canUseAgent && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent agent runs</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1">
                {recentAgentRuns.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No runs yet.{" "}
                    <Link href="/dashboard/agent" className="underline">
                      Give the AI Sales Employee a goal
                    </Link>
                    .
                  </p>
                ) : (
                  recentAgentRuns.slice(0, 5).map((run) => (
                    <Link
                      key={run.id}
                      href="/dashboard/agent"
                      className="flex items-center justify-between gap-2 rounded-md p-2 text-sm hover:bg-accent"
                    >
                      <span className="truncate">{run.goal}</span>
                      <Badge variant={AGENT_STATUS_VARIANT[run.status]} className="shrink-0 capitalize">
                        {run.status.replace("_", " ")}
                      </Badge>
                    </Link>
                  ))
                )}
              </CardContent>
            </Card>
          )}

          {canViewBilling && subscription && usage && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  {subscription.plan.name} plan
                  <Badge variant="secondary" className="capitalize">
                    {subscription.status.replace("_", " ")}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {usage.map((u) => {
                  const pct = u.limit > 0 ? Math.min(100, Math.round((u.used / u.limit) * 100)) : 0;
                  return (
                    <div key={u.metric}>
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{u.metric === "ai_tokens" ? "AI tokens" : "Agent runs"}</span>
                        <span>
                          {u.used.toLocaleString()} / {u.limit.toLocaleString()}
                        </span>
                      </div>
                      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn("h-full rounded-full", pct >= 100 ? "bg-destructive" : "bg-primary")}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
                <Link href="/dashboard/settings/billing" className="text-xs text-muted-foreground underline">
                  Manage billing
                </Link>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
