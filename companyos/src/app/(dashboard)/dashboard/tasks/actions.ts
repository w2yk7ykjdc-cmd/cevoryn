"use server";

import { revalidatePath } from "next/cache";
import type { TaskPriority, TaskStatus } from "@prisma/client";
import { requirePermission } from "@/server/auth/session";
import { createTask, softDeleteTask, updateTask } from "@/server/tasks/service";
import type { ActionResult } from "@/app/(dashboard)/dashboard/members/actions";

export async function createTaskAction(input: {
  title: string;
  description?: string;
  priority?: TaskPriority;
  dueDate?: string;
  reminderAt?: string;
  assigneeId?: string;
  leadId?: string;
  contactId?: string;
  companyId?: string;
}): Promise<ActionResult> {
  const { session, organization } = await requirePermission({ task: ["create"] });

  if (!input.title.trim()) {
    return { success: false, error: "Task title is required" };
  }

  try {
    await createTask({
      organizationId: organization.id,
      actorId: session.user.id,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      priority: input.priority,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      reminderAt: input.reminderAt ? new Date(input.reminderAt) : null,
      assigneeId: input.assigneeId || null,
      leadId: input.leadId || null,
      contactId: input.contactId || null,
      companyId: input.companyId || null,
    });
    revalidatePath("/dashboard/tasks");
    if (input.contactId) revalidatePath(`/dashboard/contacts/${input.contactId}`);
    if (input.companyId) revalidatePath(`/dashboard/companies/${input.companyId}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to create task" };
  }
}

export async function updateTaskAction(
  taskId: string,
  input: {
    title?: string;
    description?: string | null;
    priority?: TaskPriority;
    status?: TaskStatus;
    dueDate?: string | null;
    assigneeId?: string | null;
  },
): Promise<ActionResult> {
  const { session, organization } = await requirePermission({ task: ["update"] });

  try {
    await updateTask({
      organizationId: organization.id,
      actorId: session.user.id,
      taskId,
      data: {
        ...input,
        dueDate: input.dueDate !== undefined ? (input.dueDate ? new Date(input.dueDate) : null) : undefined,
      },
    });
    revalidatePath("/dashboard/tasks");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to update task" };
  }
}

export async function deleteTaskAction(taskId: string): Promise<ActionResult> {
  const { session, organization } = await requirePermission({ task: ["delete"] });

  try {
    await softDeleteTask(organization.id, taskId, session.user.id);
    revalidatePath("/dashboard/tasks");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to delete task" };
  }
}
