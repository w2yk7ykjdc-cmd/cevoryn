import { requireActiveOrganization } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function DashboardOverviewPage() {
  const { organization } = await requireActiveOrganization();

  const [memberCount, conversationCount, auditLogCount] = await Promise.all([
    prisma.member.count({ where: { organizationId: organization.id } }),
    prisma.conversation.count({ where: { organizationId: organization.id } }),
    prisma.auditLog.count({ where: { organizationId: organization.id } }),
  ]);

  const stats = [
    { label: "Members", value: memberCount },
    { label: "AI conversations", value: conversationCount },
    { label: "Audit log entries", value: auditLogCount },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{organization.name}</h1>
        <p className="text-sm text-muted-foreground">Workspace overview</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader>
              <CardDescription>{stat.label}</CardDescription>
              <CardTitle className="text-3xl">{stat.value}</CardTitle>
            </CardHeader>
            <CardContent />
          </Card>
        ))}
      </div>
    </div>
  );
}
