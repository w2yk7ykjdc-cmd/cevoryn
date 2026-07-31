import { requirePermission } from "@/server/auth/session";
import { listTasks } from "@/server/tasks/service";
import { prisma } from "@/server/db/client";
import { listLeads } from "@/server/leads/service";
import { Card, CardContent } from "@/components/ui/card";
import { CreateTaskDialog } from "@/app/(dashboard)/dashboard/tasks/create-task-dialog";
import { TasksTable } from "@/app/(dashboard)/dashboard/tasks/tasks-table";

export default async function TasksPage() {
  const { organization } = await requirePermission({ task: ["read"] });

  const [{ tasks }, members, { leads }] = await Promise.all([
    listTasks({ organizationId: organization.id, limit: 200 }),
    prisma.member.findMany({
      where: { organizationId: organization.id },
      include: { user: { select: { id: true, name: true } } },
    }),
    listLeads({ organizationId: organization.id, limit: 200 }),
  ]);

  const assignees = members.map((m) => ({ id: m.user.id, name: m.user.name }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
          <p className="text-sm text-muted-foreground">{tasks.length} open.</p>
        </div>
        <CreateTaskDialog
          assignees={assignees}
          leads={leads.map((l) => ({ id: l.id, title: l.title }))}
        />
      </div>

      <Card>
        <CardContent className="pt-6">
          <TasksTable
            tasks={tasks.map((t) => ({
              id: t.id,
              title: t.title,
              status: t.status,
              priority: t.priority,
              dueDate: t.dueDate,
              assigneeName: t.assignee?.name ?? null,
              leadId: t.lead?.id ?? null,
              leadTitle: t.lead?.title ?? null,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
