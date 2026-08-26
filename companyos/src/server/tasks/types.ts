import type { TaskPriority, TaskStatus } from "@prisma/client";

export type CreateTaskInput = {
  organizationId: string;
  actorId: string;
  actorType?: "user" | "ai";
  title: string;
  description?: string | null;
  priority?: TaskPriority;
  dueDate?: Date | null;
  reminderAt?: Date | null;
  assigneeId?: string | null;
  leadId?: string | null;
  contactId?: string | null;
  companyId?: string | null;
};

export type UpdateTaskInput = {
  organizationId: string;
  actorId: string;
  taskId: string;
  data: {
    title?: string;
    description?: string | null;
    priority?: TaskPriority;
    status?: TaskStatus;
    dueDate?: Date | null;
    reminderAt?: Date | null;
    assigneeId?: string | null;
  };
};

export type ListTasksInput = {
  organizationId: string;
  status?: TaskStatus;
  assigneeId?: string;
  leadId?: string;
  contactId?: string;
  companyId?: string;
  query?: string;
  cursor?: string;
  limit?: number;
};

export class TaskNotFoundError extends Error {
  constructor(taskId: string) {
    super(`Task "${taskId}" was not found in this organization`);
    this.name = "TaskNotFoundError";
  }
}

export class TaskAssigneeReferenceError extends Error {
  constructor(assigneeId: string) {
    super(`User "${assigneeId}" is not a member of this organization`);
    this.name = "TaskAssigneeReferenceError";
  }
}

export class TaskLeadReferenceError extends Error {
  constructor(leadId: string) {
    super(`Lead "${leadId}" was not found in this organization`);
    this.name = "TaskLeadReferenceError";
  }
}

export class TaskContactReferenceError extends Error {
  constructor(contactId: string) {
    super(`Contact "${contactId}" was not found in this organization`);
    this.name = "TaskContactReferenceError";
  }
}

export class TaskCompanyReferenceError extends Error {
  constructor(companyId: string) {
    super(`Company "${companyId}" was not found in this organization`);
    this.name = "TaskCompanyReferenceError";
  }
}
