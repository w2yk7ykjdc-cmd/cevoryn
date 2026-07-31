import { prisma } from "@/server/db/client";
import { publishEvent } from "@/server/events/event-bus";
import { sendEmail } from "@/server/jobs/email";
import { logger } from "@/server/logger/logger";

/**
 * Finds tasks whose reminder has come due and haven't been reminded about
 * yet, emails the assignee (if any), marks them sent, and publishes
 * `task.reminder_due` so other consumers (e.g. an in-app notification
 * center, once one exists) can react too. Runs across every organization —
 * called on a schedule by the background worker, not per-tenant.
 */
export async function sweepDueReminders(): Promise<number> {
  const dueTasks = await prisma.task.findMany({
    where: {
      reminderAt: { lte: new Date() },
      reminderSentAt: null,
      deletedAt: null,
      status: { notIn: ["done", "cancelled"] },
    },
    include: { assignee: { select: { id: true, name: true, email: true } } },
    take: 200,
  });

  let sent = 0;
  for (const task of dueTasks) {
    if (task.assignee?.email) {
      try {
        await sendEmail({
          to: task.assignee.email,
          subject: `Reminder: ${task.title}`,
          html: `
            <p>Hi ${task.assignee.name},</p>
            <p>This is a reminder for your task: <strong>${task.title}</strong></p>
            ${task.dueDate ? `<p>Due: ${task.dueDate.toLocaleDateString()}</p>` : ""}
          `,
        });
      } catch (err) {
        logger.error({ err, taskId: task.id }, "failed to send task reminder email");
      }
    }

    await prisma.task.update({ where: { id: task.id }, data: { reminderSentAt: new Date() } });

    await publishEvent(
      "task.reminder_due",
      {
        taskId: task.id,
        organizationId: task.organizationId,
        assigneeId: task.assigneeId,
        title: task.title,
      },
      { organizationId: task.organizationId },
    );

    sent += 1;
  }

  return sent;
}
