import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/client";
import { createLead } from "@/server/leads/service";
import {
  createTask,
  getTask,
  listTasks,
  softDeleteTask,
  updateTask,
} from "@/server/tasks/service";
import {
  TaskAssigneeReferenceError,
  TaskLeadReferenceError,
  TaskNotFoundError,
} from "@/server/tasks/types";
import { sweepDueReminders } from "@/server/tasks/reminders";
import { addMemberDirect, closeTestConnections, createOrgForUser, signUpUser } from "./helpers";

describe("tasks", () => {
  afterAll(closeTestConnections);

  async function setup() {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    return { owner, organization };
  }

  it("creates a task defaulting to the creator as assignee and medium priority", async () => {
    const { owner, organization } = await setup();

    const task = await createTask({
      organizationId: organization.id,
      actorId: owner.userId,
      title: "Follow up with Acme",
    });

    expect(task.assigneeId).toBe(owner.userId);
    expect(task.priority).toBe("medium");
    expect(task.status).toBe("todo");

    const auditEntry = await prisma.auditLog.findFirst({
      where: { organizationId: organization.id, action: "task.created", targetId: task.id },
    });
    expect(auditEntry?.actorType).toBe("user");
  });

  it("records an ai actorType on the audit log when created on the AI's behalf", async () => {
    const { owner, organization } = await setup();

    const task = await createTask({
      organizationId: organization.id,
      actorId: owner.userId,
      actorType: "ai",
      title: "AI-created follow-up",
    });

    const auditEntry = await prisma.auditLog.findFirst({
      where: { organizationId: organization.id, action: "task.created", targetId: task.id },
    });
    expect(auditEntry?.actorType).toBe("ai");
  });

  it("rejects an assignee who isn't a member of the organization", async () => {
    const { owner, organization } = await setup();
    const outsider = await signUpUser();

    await expect(
      createTask({
        organizationId: organization.id,
        actorId: owner.userId,
        title: "Bad assignee",
        assigneeId: outsider.userId,
      }),
    ).rejects.toThrow(TaskAssigneeReferenceError);
  });

  it("accepts an assignee who is a member, even if not the creator", async () => {
    const { owner, organization } = await setup();
    const member = await signUpUser();
    await addMemberDirect(organization.id, member, "member");

    const task = await createTask({
      organizationId: organization.id,
      actorId: owner.userId,
      title: "Assigned to teammate",
      assigneeId: member.userId,
    });
    expect(task.assigneeId).toBe(member.userId);
  });

  it("links a task to a lead and appends a task_created activity entry", async () => {
    const { owner, organization } = await setup();
    const lead = await createLead({ organizationId: organization.id, actorId: owner.userId, title: "Big Deal" });

    const task = await createTask({
      organizationId: organization.id,
      actorId: owner.userId,
      title: "Send proposal",
      leadId: lead.id,
    });

    expect(task.leadId).toBe(lead.id);

    const activity = await prisma.leadActivity.findFirst({
      where: { leadId: lead.id, type: "task_created" },
    });
    expect(activity?.metadata).toMatchObject({ taskId: task.id });
  });

  it("rejects a lead from a different organization", async () => {
    const a = await setup();
    const b = await setup();
    const leadInB = await createLead({ organizationId: b.organization.id, actorId: b.owner.userId, title: "B Lead" });

    await expect(
      createTask({ organizationId: a.organization.id, actorId: a.owner.userId, title: "X", leadId: leadInB.id }),
    ).rejects.toThrow(TaskLeadReferenceError);
  });

  it("sets completedAt when status moves to done, clears it when reopened", async () => {
    const { owner, organization } = await setup();
    const task = await createTask({ organizationId: organization.id, actorId: owner.userId, title: "Toggle me" });

    const done = await updateTask({
      organizationId: organization.id,
      actorId: owner.userId,
      taskId: task.id,
      data: { status: "done" },
    });
    expect(done.completedAt).not.toBeNull();

    const reopened = await updateTask({
      organizationId: organization.id,
      actorId: owner.userId,
      taskId: task.id,
      data: { status: "todo" },
    });
    expect(reopened.completedAt).toBeNull();
  });

  it("refuses to update a task belonging to a different organization", async () => {
    const a = await setup();
    const b = await setup();
    const task = await createTask({ organizationId: a.organization.id, actorId: a.owner.userId, title: "A task" });

    await expect(
      updateTask({
        organizationId: b.organization.id,
        actorId: b.owner.userId,
        taskId: task.id,
        data: { title: "Hijacked" },
      }),
    ).rejects.toThrow(TaskNotFoundError);
  });

  it("does not leak tasks across organizations and filters by status", async () => {
    const a = await setup();
    const b = await setup();
    const t1 = await createTask({ organizationId: a.organization.id, actorId: a.owner.userId, title: "A1" });
    await createTask({ organizationId: a.organization.id, actorId: a.owner.userId, title: "A2" });
    await createTask({ organizationId: b.organization.id, actorId: b.owner.userId, title: "B1" });

    await updateTask({ organizationId: a.organization.id, actorId: a.owner.userId, taskId: t1.id, data: { status: "done" } });

    const { tasks: allA } = await listTasks({ organizationId: a.organization.id });
    expect(allA).toHaveLength(2);

    const { tasks: doneA } = await listTasks({ organizationId: a.organization.id, status: "done" });
    expect(doneA).toHaveLength(1);
    expect(doneA[0]?.title).toBe("A1");
  });

  it("soft-deletes a task: hidden from reads, audit logged", async () => {
    const { owner, organization } = await setup();
    const task = await createTask({ organizationId: organization.id, actorId: owner.userId, title: "Delete me" });

    await softDeleteTask(organization.id, task.id, owner.userId);

    expect(await getTask(organization.id, task.id)).toBeNull();
    const auditEntry = await prisma.auditLog.findFirst({
      where: { organizationId: organization.id, action: "task.deleted", targetId: task.id },
    });
    expect(auditEntry).not.toBeNull();
  });

  it("sweeps due reminders exactly once and publishes task.reminder_due", async () => {
    const { owner, organization } = await setup();
    const task = await createTask({
      organizationId: organization.id,
      actorId: owner.userId,
      title: "Remind me",
      reminderAt: new Date(Date.now() - 60_000), // already due
    });

    const firstSweep = await sweepDueReminders();
    expect(firstSweep).toBeGreaterThanOrEqual(1);

    const updated = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(updated.reminderSentAt).not.toBeNull();

    const event = await prisma.domainEvent.findFirst({
      where: { organizationId: organization.id, type: "task.reminder_due" },
    });
    expect(event).not.toBeNull();
    expect((event?.payload as { taskId: string }).taskId).toBe(task.id);

    // Second sweep must not pick the same task up again.
    const reminderCountBefore = await prisma.domainEvent.count({
      where: { organizationId: organization.id, type: "task.reminder_due" },
    });
    await sweepDueReminders();
    const reminderCountAfter = await prisma.domainEvent.count({
      where: { organizationId: organization.id, type: "task.reminder_due" },
    });
    expect(reminderCountAfter).toBe(reminderCountBefore);
  });

  it("does not send a reminder for a task without a due reminder", async () => {
    const { owner, organization } = await setup();
    await createTask({ organizationId: organization.id, actorId: owner.userId, title: "No reminder" });

    const before = await prisma.domainEvent.count({
      where: { organizationId: organization.id, type: "task.reminder_due" },
    });
    await sweepDueReminders();
    const after = await prisma.domainEvent.count({
      where: { organizationId: organization.id, type: "task.reminder_due" },
    });
    expect(after).toBe(before);
  });
});
