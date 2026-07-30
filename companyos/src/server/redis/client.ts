import Redis from "ioredis";
import { env } from "@/env";
import { logger } from "@/server/logger/logger";

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

/** Capped exponential backoff so a prolonged outage retries steadily instead of flooding logs. */
function retryStrategy(attempt: number): number {
  return Math.min(attempt * 200, 5000);
}

function createClient(): Redis {
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableAutoPipelining: true,
    // Connect on first command rather than at instantiation, so importing
    // this module (e.g. during `next build`'s static analysis, when no
    // Redis is running) never triggers a connection attempt.
    lazyConnect: true,
    retryStrategy,
  });

  let lastErrorLoggedAt = 0;
  client.on("error", (err) => {
    const now = Date.now();
    if (now - lastErrorLoggedAt > 10_000) {
      lastErrorLoggedAt = now;
      logger.error({ err }, "redis connection error");
    }
  });

  return client;
}

/**
 * Process-wide ioredis singleton, reused across hot reloads in dev. Backs
 * rate limiting, the event bus pub/sub adapter, and BullMQ queues.
 */
export const redis = globalForRedis.redis ?? createClient();

if (env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
}

/**
 * BullMQ requires its own connection per Queue/Worker with
 * `maxRetriesPerRequest: null`. Use this factory instead of the shared
 * `redis` client when constructing Queue/Worker/QueueEvents instances.
 */
export function createBullConnection(): Redis {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });
}
