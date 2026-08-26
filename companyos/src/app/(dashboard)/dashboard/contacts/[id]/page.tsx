import { notFound } from "next/navigation";
import { requirePermission } from "@/server/auth/session";
import { getContact } from "@/server/contacts/service";
import { listCompanies } from "@/server/companies/service";
import { listTasks } from "@/server/tasks/service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ContactDetail } from "@/app/(dashboard)/dashboard/contacts/[id]/contact-detail";

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { organization } = await requirePermission({ contact: ["read"] });

  const [contact, { companies }, { tasks }] = await Promise.all([
    getContact(organization.id, id),
    listCompanies({ organizationId: organization.id, limit: 200 }),
    listTasks({ organizationId: organization.id, contactId: id, limit: 50 }),
  ]);

  if (!contact) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <ContactDetail
        contact={contact}
        companies={companies.map((c) => ({ id: c.id, name: c.name }))}
      />

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
  );
}
