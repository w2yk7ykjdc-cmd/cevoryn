import { relayUnprocessedEvents } from "@/server/events/event-bus";
import { logger } from "@/server/logger/logger";

export async function relayOutboxEventsProcessor(): Promise<void> {
  const relayed = await relayUnprocessedEvents();
  if (relayed > 0) {
    logger.info({ relayed }, "relayed unprocessed outbox events");
  }
}
