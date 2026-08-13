/**
 * Pure rate-limit logic, deliberately free of "server-only"/Prisma/Next
 * imports so it's directly unit-testable under plain `node:test`. The
 * server-only wrapper (auth-rate-limit.service.ts) wires this to the real
 * database and real request headers.
 */

export type AuthRateLimitAction =
  | "login_email"
  | "login_ip"
  | "signup_ip"
  | "forgot_password_email"
  | "polar_checkout_org"
  | "billing_portal_org"
  | "change_plan_org";

interface RateLimitRule {
  windowMs: number;
  limit: number;
}

/**
 * Per-action limits. login_email/login_ip are only incremented on a
 * FAILED sign-in attempt (a successful login never counts against the
 * budget). signup_ip and forgot_password_email are incremented on every
 * attempt regardless of outcome, since neither has a meaningful
 * "failure" worth distinguishing for abuse purposes.
 *
 * The three Polar billing actions (polar_checkout_org, billing_portal_org,
 * change_plan_org) reuse this same module (despite the "auth" name)
 * rather than a second rate-limit implementation - they're keyed by
 * organizationId instead of email/IP since the caller is already an
 * authenticated org admin/owner by the time these run. Limits are
 * generous enough for legitimate retries (a declined card, a flaky
 * network) while still bounding how hard a bug or a compromised session
 * can hammer Polar's API.
 */
export const AUTH_RATE_LIMIT_RULES: Record<AuthRateLimitAction, RateLimitRule> =
  {
    login_email: { windowMs: 15 * 60 * 1000, limit: 5 },
    login_ip: { windowMs: 15 * 60 * 1000, limit: 20 },
    signup_ip: { windowMs: 60 * 60 * 1000, limit: 5 },
    forgot_password_email: { windowMs: 60 * 60 * 1000, limit: 3 },
    polar_checkout_org: { windowMs: 10 * 60 * 1000, limit: 10 },
    billing_portal_org: { windowMs: 10 * 60 * 1000, limit: 20 },
    change_plan_org: { windowMs: 10 * 60 * 1000, limit: 10 },
  };

/** Minimal storage contract — implemented for real by Prisma, and by an
 * in-memory fake in tests. */
export interface AuthRateLimitStore {
  countSince(
    action: AuthRateLimitAction,
    key: string,
    since: Date
  ): Promise<number>;
  record(action: AuthRateLimitAction, key: string): Promise<void>;
}

export async function isAuthRateLimited(
  store: AuthRateLimitStore,
  action: AuthRateLimitAction,
  key: string,
  now: Date = new Date()
): Promise<boolean> {
  const rule = AUTH_RATE_LIMIT_RULES[action];
  const cutoff = new Date(now.getTime() - rule.windowMs);
  const count = await store.countSince(action, key, cutoff);
  return count >= rule.limit;
}

export async function recordAuthAttempt(
  store: AuthRateLimitStore,
  action: AuthRateLimitAction,
  key: string
): Promise<void> {
  await store.record(action, key);
}

/**
 * Extracts the client IP from already-read header values. `x-forwarded-for`'s
 * first entry is preferred — Vercel's edge sets/prepends this itself rather
 * than passing through whatever a client sent. Falls back to `x-real-ip`.
 * Returns null if neither is present.
 */
export function parseClientIpFromHeaderValues(
  forwardedFor: string | null,
  realIp: string | null
): string | null {
  const firstForwarded = forwardedFor?.split(",")[0]?.trim();
  if (firstForwarded) return firstForwarded;

  const trimmedRealIp = realIp?.trim();
  if (trimmedRealIp) return trimmedRealIp;

  return null;
}
