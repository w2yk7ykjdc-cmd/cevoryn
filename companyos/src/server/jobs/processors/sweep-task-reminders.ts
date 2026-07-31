import { sweepDueReminders } from "@/server/tasks/reminders";
import { logger } from "@/server/logger/logger";

export async function sweepTaskRemindersProcessor(): Promise<void> {
  const sent = await sweepDueReminders();
  if (sent > 0) {
    logger.info({ sent }, "sent task reminders");
  }
}
