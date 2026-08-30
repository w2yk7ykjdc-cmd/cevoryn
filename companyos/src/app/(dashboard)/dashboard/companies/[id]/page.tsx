import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/server/auth/session";
import { getCompany } from "@/server/companies/service";
import { getTenantScopedClient } from "@/server/db/tenant";
import { listTasks } from "@/server/tasks/service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CompanyDetail } from "@/app/(dashboard)/dashboard/companies/[id]/company-detail";

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { organization } = await requirePermission({ company: ["read"] });

  const company = await getCompany(organization.id, id);
  if (!company) {
    notFound();
  }

  const scoped = getTenantScopedClient(organization.id);
  const [contacts, leads, { tasks }] = await Promise.all([
    scoped.contact.findMany({
      where: { companyId: id, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    scoped.lead.findMany({
      where: { companyId: id, deletedAt: null },
      include: { stage: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    listTasks({ organizationId: organization.id, companyId: id, limit: 50 }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <CompanyDetail company={company} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contacts ({contacts.length})</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {contacts.length === 0 && (
              <p className="text-sm text-muted-foreground">No contacts at this company yet.</p>
            )}
            {contacts.map((contact) => (
              <Link
                key={contact.id}
                href={`/dashboard/contacts/${contact.id}`}
                className="rounded-md border px-3 py-2 text-sm hover:bg-accent"
              >
                {contact.firstName} {contact.lastName}
                {contact.title ? ` — ${contact.title}` : ""}
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Leads ({leads.length})</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {leads.length === 0 && (
              <p className="text-sm text-muted-foreground">No leads for this company yet.</p>
            )}
            {leads.map((lead) => (
              <Link
                key={lead.id}
                href={`/dashboard/leads/${lead.id}`}
                className="flex items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-accent"
              >
                <span>{lead.title}</span>
                <Badge variant="secondary">{lead.stage.name}</Badge>
              </Link>
            ))}
          </CardContent>
        </Card>

        {tasks.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tasks ({tasks.length})</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {tasks.map((task) => (
                <div key={task.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                  <span>{task.title}</span>
                  <div className="flex items-center gap-2">
                    {task.dueDate && (
                      <span className="text-xs text-muted-foreground">
                        {new Date(task.dueDate).toLocaleDateString()}
                      </span>
                    )}
                    <Badge variant="secondary" className="capitalize">
                      {task.status.replace("_", " ")}
                    </Badge>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
