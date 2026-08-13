import "server-only";

import { headers } from "next/headers";

import { prisma } from "@/lib/prisma";

import {
  isAuthRateLimited as isAuthRateLimitedCore,
  parseClientIpFromHeaderValues,
  recordAuthAttempt as recordAuthAttemptCore,
  tryRecordAuthAttempt as tryRecordAuthAttemptCore,
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
  async tryRecord(action, key, since, limit) {
    return prisma.$transaction(async (tx) => {
      // A plain count() followed by create() has a TOCTOU window under
      // Postgres's default READ COMMITTED isolation: two concurrent
      // requests for the same action+key can both see "under the limit"
      // before either has inserted, letting both through. A transaction-
      // scoped advisory lock keyed by hash(action:key) serializes callers
      // that share a key — the second waits for the first transaction to
      // commit before it takes its own count, so the check-then-insert
      // below is effectively atomic per key. Different keys hash to
      // different lock ids (mod hash collisions, harmless — they'd only
      // cause unrelated keys to briefly serialize, never a bypass) so
      // unrelated organizations/emails/IPs never block each other.
      // Released automatically when the transaction commits or rolls back.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${action}:${key}`}, 0))`;

      const count = await tx.authRateLimitAttempt.count({
        where: { action, key, createdAt: { gte: since } },
      });
      if (count >= limit) return false;

      await tx.authRateLimitAttempt.create({ data: { action, key } });
      return true;
    });
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
 * Atomic check-and-record — use this instead of isAuthRateLimited() +
 * recordAuthAttempt() when the caller records unconditionally on every
 * attempt (not just on failure), to avoid the check-then-act race between
 * the two calls. Returns true if allowed (recorded), false if blocked.
 */
export function tryRecordAuthAttempt(
  action: AuthRateLimitAction,
  key: string
): Promise<boolean> {
  return tryRecordAuthAttemptCore(prismaStore, action, key);
}

/**
 * Deletes auth_rate_limit_attempts rows older than `olderThanHours`. A row
 * can only ever affect a future check while it's inside that action's own
 * rate-limit window (see AUTH_RATE_LIMIT_RULES) - the longest configured
 * window today is 60 minutes (signup_ip, forgot_password_email). Default
 * of 24 hours is a generous multiple of that (safe against clock skew and
 * missed/delayed cron runs) while still keeping the table from growing
 * unbounded - every login/checkout/portal/change-plan attempt inserts a
 * row that was otherwise never deleted.
 */
export async function cleanupStaleAuthRateLimitAttempts(
  olderThanHours = 24
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
  return prisma.$executeRaw`
    DELETE FROM "auth_rate_limit_attempts" WHERE "created_at" < ${cutoff}
  `;
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
