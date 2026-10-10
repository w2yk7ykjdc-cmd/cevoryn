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
  | "resend_confirmation_email"
  | "invite_accept_user"
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
 * authenticated org admin/owner by the time these run.
 *
 * These three limits are a starting estimate, not a calibrated figure -
 * there's no production traffic history for this integration yet to size
 * them against. The reasoning: checkout/change_plan involve a real
 * external API call to Polar per attempt, so 10/10min comfortably covers
 * a legitimate user retrying a declined card or a flaky network several
 * times, while still bounding how hard a bug or a compromised session
 * could hammer Polar's API before the window resets. billing_portal_org
 * is read-like (opens a hosted session, no state change) so it gets a
 * looser 20/10min. Revisit these once there's real usage data - a 429 a
 * legitimate admin actually hits in practice is a signal to raise the
 * limit, not proof the limit is doing its job.
 */
export const AUTH_RATE_LIMIT_RULES: Record<AuthRateLimitAction, RateLimitRule> =
  {
    login_email: { windowMs: 15 * 60 * 1000, limit: 5 },
    login_ip: { windowMs: 15 * 60 * 1000, limit: 20 },
    signup_ip: { windowMs: 60 * 60 * 1000, limit: 5 },
    forgot_password_email: { windowMs: 60 * 60 * 1000, limit: 3 },
    resend_confirmation_email: { windowMs: 60 * 60 * 1000, limit: 3 },
    // Keyed by the authenticated user's id (not email/IP) - invite tokens
    // are already unguessable CSPRNG values, so this bounds brute-force
    // token guessing by a signed-in account rather than enumeration.
    invite_accept_user: { windowMs: 10 * 60 * 1000, limit: 10 },
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
  /**
   * Atomically checks the window count against `limit` and, if still
   * under it, records the attempt — as a single DB-level operation.
   * Returns true if the attempt was allowed (and recorded), false if it
   * was rejected as already at/over the limit (nothing recorded).
   *
   * This exists to close the check-then-act race between calling
   * isAuthRateLimited() and recordAuthAttempt() as two separate steps:
   * under concurrent requests, both can observe "under the limit" before
   * either has recorded anything, letting more than `limit` attempts
   * through. Callers that need atomicity (currently the three
   * organization-keyed billing actions) should call
   * tryRecordAuthAttempt() instead of the two-step pattern.
   */
  tryRecord(
    action: AuthRateLimitAction,
    key: string,
    since: Date,
    limit: number
  ): Promise<boolean>;
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
 * Atomic check-and-record: returns true if the attempt is allowed (and
 * has been recorded), false if it was blocked by the limit (nothing was
 * recorded). See AuthRateLimitStore.tryRecord for why this exists instead
 * of composing isAuthRateLimited() + recordAuthAttempt().
 */
export async function tryRecordAuthAttempt(
  store: AuthRateLimitStore,
  action: AuthRateLimitAction,
  key: string,
  now: Date = new Date()
): Promise<boolean> {
  const rule = AUTH_RATE_LIMIT_RULES[action];
  const cutoff = new Date(now.getTime() - rule.windowMs);
  return store.tryRecord(action, key, cutoff, rule.limit);
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
