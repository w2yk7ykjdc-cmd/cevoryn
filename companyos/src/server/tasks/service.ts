import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { getTenantScopedClient } from "@/server/db/tenant";
import { recordAuditLog, publishAuditEvent } from "@/server/audit/audit-log";
import {
  TaskAssigneeReferenceError,
  TaskLeadReferenceError,
  TaskNotFoundError,
} from "@/server/tasks/types";
import type { CreateTaskInput, ListTasksInput, UpdateTaskInput } from "@/server/tasks/types";

async function assertAssigneeIsMember(
  tx: Prisma.TransactionClient,
  organizationId: string,
  assigneeId: string,
) {
  const member = await tx.member.findFirst({ where: { organizationId, userId: assigneeId } });
  if (!member) {
    throw new TaskAssigneeReferenceError(assigneeId);
  }
}

async function assertLeadBelongsToOrg(
  tx: Prisma.TransactionClient,
  organizationId: string,
  leadId: string,
) {
  const lead = await tx.lead.findFirst({
    where: { id: leadId, organizationId, deletedAt: null },
    select: { id: true },
  });
  if (!lead) {
    throw new TaskLeadReferenceError(leadId);
  }
}

export async function createTask(input: CreateTaskInput) {
  const actorType = input.actorType ?? "user";

  const { task, auditEntry } = await prisma.$transaction(async (tx) => {
    if (input.assigneeId) {
      await assertAssigneeIsMember(tx, input.organizationId, input.assigneeId);
    }
    if (input.leadId) {
      await assertLeadBelongsToOrg(tx, input.organizationId, input.leadId);
    }

    const task = await tx.task.create({
      data: {
        organizationId: input.organizationId,
        createdById: input.actorId,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority ?? "medium",
        dueDate: input.dueDate ?? null,
        reminderAt: input.reminderAt ?? null,
        assigneeId: input.assigneeId ?? input.actorId,
        leadId: input.leadId ?? null,
        contactId: input.contactId ?? null,
        companyId: input.companyId ?? null,
      },
    });

    if (input.leadId) {
      await tx.leadActivity.create({
        data: {
          organizationId: input.organizationId,
          leadId: input.leadId,
          type: "task_created",
          body: `Task created: "${task.title}"`,
          metadata: { taskId: task.id },
          actorId: actorType === "user" ? input.actorId : null,
        },
      });
    }

    const auditEntry = await recordAuditLog(
      {
        organizationId: input.organizationId,
        actorId: input.actorId,
        actorType,
        action: "task.created",
        targetType: "task",
        targetId: task.id,
        metadata: { title: task.title, leadId: input.leadId ?? null },
      },
      tx,
    );

    return { task, auditEntry };
  });

  await publishAuditEvent(auditEntry);
  return task;
}

export async function updateTask(input: UpdateTaskInput) {
  const { task, auditEntry } = await prisma.$transaction(async (tx) => {
    const existing = await tx.task.findFirst({
      where: { id: input.taskId, organizationId: input.organizationId, deletedAt: null },
    });
    if (!existing) {
      throw new TaskNotFoundError(input.taskId);
    }
    if (input.data.assigneeId) {
      await assertAssigneeIsMember(tx, input.organizationId, input.data.assigneeId);
    }

    const statusChanged = input.data.status !== undefined && input.data.status !== existing.status;

    const task = await tx.task.update({
      where: { id: existing.id },
      data: {
        ...input.data,
        completedAt: statusChanged
          ? input.data.status === "done"
            ? new Date()
            : null
          : undefined,
      },
    });

    const auditEntry = await recordAuditLog(
      {
        organizationId: input.organizationId,
        actorId: input.actorId,
        actorType: "user",
        action: "task.updated",
        targetType: "task",
        targetId: task.id,
        metadata: { changes: input.data },
      },
      tx,
    );

    return { task, auditEntry };
  });

  await publishAuditEvent(auditEntry);
  return task;
}

export async function softDeleteTask(organizationId: string, taskId: string, actorId: string) {
  const { auditEntry } = await prisma.$transaction(async (tx) => {
    const existing = await tx.task.findFirst({
      where: { id: taskId, organizationId, deletedAt: null },
    });
    if (!existing) {
      throw new TaskNotFoundError(taskId);
    }

    await tx.task.update({ where: { id: taskId }, data: { deletedAt: new Date() } });

    const auditEntry = await recordAuditLog(
      {
        organizationId,
        actorId,
        actorType: "user",
        action: "task.deleted",
        targetType: "task",
        targetId: taskId,
        metadata: { title: existing.title },
      },
      tx,
    );

    return { auditEntry };
  });

  await publishAuditEvent(auditEntry);
}

export async function getTask(organizationId: string, taskId: string) {
  const scoped = getTenantScopedClient(organizationId);
  return scoped.task.findFirst({
    where: { id: taskId, deletedAt: null },
    include: {
      assignee: { select: { id: true, name: true, email: true } },
      lead: { select: { id: true, title: true } },
      contact: { select: { id: true, firstName: true, lastName: true } },
      company: { select: { id: true, name: true } },
    },
  });
}

export async function listTasks(input: ListTasksInput) {
  const scoped = getTenantScopedClient(input.organizationId);
  const limit = Math.min(input.limit ?? 50, 200);

  const tasks = await scoped.task.findMany({
    where: {
      deletedAt: null,
      status: input.status,
      assigneeId: input.assigneeId,
      leadId: input.leadId,
      title: input.query ? { contains: input.query, mode: "insensitive" } : undefined,
    },
    include: {
      assignee: { select: { id: true, name: true } },
      lead: { select: { id: true, title: true } },
    },
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take: limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });

  const hasMore = tasks.length > limit;
  const page = hasMore ? tasks.slice(0, limit) : tasks;

  return { tasks: page, nextCursor: hasMore ? page[page.length - 1]?.id : null };
}
