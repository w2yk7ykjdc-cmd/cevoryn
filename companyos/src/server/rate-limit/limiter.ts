import "server-only";
import { redis } from "@/server/redis/client";

export type RateLimitResult = {
  success: boolean;
  limit: number;
  remaining: number;
  /** Unix ms timestamp when the window resets. */
  resetAt: number;
};

// Atomic fixed-window counter: INCR then, only on the first hit in the
// window, set an expiry. Avoids the read-then-write race a naive
// GET/SET/EXPIRE sequence would have under concurrent requests.
const FIXED_WINDOW_SCRIPT = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
return { current, ttl }
`;

/**
 * Fixed-window rate limiter backed by Redis. Suitable for per-tenant API
 * quotas, per-user auth attempt limits, and per-key AI request throttling.
 * `key` should already encode the dimension being limited, e.g.
 * `ratelimit:org:{orgId}:api` or `ratelimit:user:{userId}:login`.
 */
export async function rateLimit(
  key: string,
  { limit, windowSeconds }: { limit: number; windowSeconds: number },
): Promise<RateLimitResult> {
  const redisKey = `ratelimit:${key}`;
  const windowMs = windowSeconds * 1000;

  const [count, ttl] = (await redis.eval(
    FIXED_WINDOW_SCRIPT,
    1,
    redisKey,
    windowMs.toString(),
  )) as [number, number];

  const remaining = Math.max(limit - count, 0);
  const resetAt = Date.now() + (ttl > 0 ? ttl : windowMs);

  return {
    success: count <= limit,
    limit,
    remaining,
    resetAt,
  };
}

/** Convenience wrapper that throws a 429-shaped error when the limit is exceeded. */
export class RateLimitExceededError extends Error {
  constructor(public readonly result: RateLimitResult) {
    super("Rate limit exceeded");
    this.name = "RateLimitExceededError";
  }
}

export async function assertWithinRateLimit(
  key: string,
  options: { limit: number; windowSeconds: number },
): Promise<RateLimitResult> {
  const result = await rateLimit(key, options);
  if (!result.success) {
    throw new RateLimitExceededError(result);
  }
  return result;
}
