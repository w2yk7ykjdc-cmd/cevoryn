import "server-only";

import { headers } from "next/headers";

import { prisma } from "@/lib/prisma";

import {
  isAuthRateLimited as isAuthRateLimitedCore,
  parseClientIpFromHeaderValues,
  recordAuthAttempt as recordAuthAttemptCore,
} from "./auth-rate-limit";
import type {
  AuthRateLimitAction,
  AuthRateLimitStore,
} from "./auth-rate-limit";

export type { AuthRateLimitAction };

const prismaStore: AuthRateLimitStore = {
  async countSince(action, key, since) {
    return prisma.authRateLimitAttempt.count({
      where: { action, key, createdAt: { gte: since } },
    });
  },
  async record(action, key) {
    await prisma.authRateLimitAttempt.create({ data: { action, key } });
  },
};

/**
 * DB-backed window check — counts rows in `auth_rate_limit_attempts`
 * created within the action's window. Deliberately not an in-memory
 * counter: this runs across many stateless serverless function instances
 * on Vercel, which don't share memory, so an in-memory count would just
 * reset per-instance and provide no real protection.
 */
export function isAuthRateLimited(
  action: AuthRateLimitAction,
  key: string
): Promise<boolean> {
  return isAuthRateLimitedCore(prismaStore, action, key);
}

/** Record one attempt for `key` under `action`. */
export function recordAuthAttempt(
  action: AuthRateLimitAction,
  key: string
): Promise<void> {
  return recordAuthAttemptCore(prismaStore, action, key);
}

/**
 * Best-effort client IP for the current request. Returns null if neither
 * `x-forwarded-for` nor `x-real-ip` is present (only expected outside
 * Vercel's network, e.g. local dev without a proxy in front) — callers
 * decide their own safe fallback behavior for that case.
 */
export async function getClientIp(): Promise<string | null> {
  const requestHeaders = await headers();
  return parseClientIpFromHeaderValues(
    requestHeaders.get("x-forwarded-for"),
    requestHeaders.get("x-real-ip")
  );
}
