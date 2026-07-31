import Redis from "ioredis";
import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db/client";
import { env } from "@/env";
import { logger } from "@/server/logger/logger";
import type { EventHandler, EventMap, EventName, EventPayload } from "@/server/events/types";

const CHANNEL_PREFIX = "companyos:events:";

/**
 * Transactional-outbox event bus.
 *
 * `publishEvent` always durably persists the event to Postgres first (the
 * `DomainEvent` outbox table), then best-effort publishes it to Redis for
 * subscribers that are online right now. If the Redis publish fails (or a
 * subscriber was offline), `relayUnprocessedEvents` — run on a schedule by
 * the background worker — replays anything still marked unprocessed. This
 * gives at-least-once delivery without requiring Redis to be perfectly
 * available at the moment an event is produced.
 *
 * Handlers registered via `subscribeEvent` run once per process per event
 * (Redis pub/sub fans out to every subscribed process, including the one
 * that published it), so treat handlers as idempotent.
 */
export async function publishEvent<E extends EventName>(
  eventName: E,
  payload: EventPayload<E>,
  options?: { organizationId?: string },
): Promise<string> {
  const event = await prisma.domainEvent.create({
    data: {
      id: randomUUID(),
      type: eventName,
      payload: payload as object,
      organizationId: options?.organizationId ?? extractOrganizationId(payload),
    },
  });

  try {
    await getPublisher().publish(
      CHANNEL_PREFIX + eventName,
      JSON.stringify({ id: event.id, payload }),
    );
    await prisma.domainEvent.update({
      where: { id: event.id },
      data: { processedAt: new Date() },
    });
  } catch (err) {
    logger.warn(
      { err, eventName, eventId: event.id },
      "event publish to redis failed; will be relayed from outbox",
    );
  }

  return event.id;
}

/** Replays outbox rows that never made it to Redis. Call from a cron job. */
export async function relayUnprocessedEvents(limit = 200): Promise<number> {
  const pending = await prisma.domainEvent.findMany({
    where: { processedAt: null },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  let relayed = 0;
  for (const event of pending) {
    try {
      await getPublisher().publish(
        CHANNEL_PREFIX + event.type,
        JSON.stringify({ id: event.id, payload: event.payload }),
      );
      await prisma.domainEvent.update({
        where: { id: event.id },
        data: { processedAt: new Date() },
      });
      relayed += 1;
    } catch (err) {
      logger.error({ err, eventId: event.id }, "failed to relay outbox event");
      break; // Redis is likely still down; stop hammering it this pass.
    }
  }
  return relayed;
}

let publisher: Redis | undefined;
function getPublisher(): Redis {
  publisher ??= new Redis(env.REDIS_URL, { lazyConnect: true });
  return publisher;
}

let subscriber: Redis | undefined;
const handlers = new Map<EventName, Set<EventHandler<EventName>>>();

function getSubscriber(): Redis {
  if (subscriber) return subscriber;

  subscriber = new Redis(env.REDIS_URL, { lazyConnect: true });
  subscriber.on("message", (channel, raw) => {
    const eventName = channel.slice(CHANNEL_PREFIX.length) as EventName;
    const registered = handlers.get(eventName);
    if (!registered || registered.size === 0) return;

    let parsed: { id: string; payload: unknown };
    try {
      parsed = JSON.parse(raw);
    } catch {
      logger.error({ channel, raw }, "received malformed event payload");
      return;
    }

    for (const handler of registered) {
      Promise.resolve(handler(parsed.payload as EventMap[EventName])).catch((err) => {
        logger.error({ err, eventName, eventId: parsed.id }, "event handler threw");
      });
    }
  });

  return subscriber;
}

/** Registers a handler for `eventName`, running in every process that calls this. */
export function subscribeEvent<E extends EventName>(
  eventName: E,
  handler: EventHandler<E>,
): () => void {
  const sub = getSubscriber();
  if (!handlers.has(eventName)) {
    handlers.set(eventName, new Set());
    void sub.subscribe(CHANNEL_PREFIX + eventName);
  }
  const set = handlers.get(eventName) as Set<EventHandler<EventName>>;
  set.add(handler as EventHandler<EventName>);

  return () => {
    set.delete(handler as EventHandler<EventName>);
    if (set.size === 0) {
      handlers.delete(eventName);
      void sub.unsubscribe(CHANNEL_PREFIX + eventName);
    }
  };
}

/** Closes the publisher/subscriber connections. Call on graceful shutdown (worker, tests). */
export async function shutdownEventBus(): Promise<void> {
  await Promise.all([publisher?.quit(), subscriber?.quit()]);
  publisher = undefined;
  subscriber = undefined;
}

function extractOrganizationId(payload: unknown): string | null {
  if (
    payload &&
    typeof payload === "object" &&
    "organizationId" in payload &&
    typeof (payload as { organizationId: unknown }).organizationId === "string"
  ) {
    return (payload as { organizationId: string }).organizationId;
  }
  return null;
}
