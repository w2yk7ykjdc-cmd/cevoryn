/**
 * Coverage for the pure auth rate-limit logic (window/limit enforcement,
 * key isolation, IP header parsing). The server-only wrapper
 * (auth-rate-limit.service.ts) that wires this to Prisma/next/headers is
 * not imported here — it can't run outside a Next.js request context, the
 * same constraint documented for other "use server" auth code this
 * session. This suite proves the actual counting/window algorithm with an
 * in-memory fake store instead of a live database.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTH_RATE_LIMIT_RULES,
  isAuthRateLimited,
  parseClientIpFromHeaderValues,
  recordAuthAttempt,
  tryRecordAuthAttempt,
} from "../src/server/services/auth-rate-limit";
import type {
  AuthRateLimitAction,
  AuthRateLimitStore,
} from "../src/server/services/auth-rate-limit";

function createFakeStore(): AuthRateLimitStore & {
  rows: Array<{ action: AuthRateLimitAction; key: string; createdAt: Date }>;
} {
  const rows: Array<{
    action: AuthRateLimitAction;
    key: string;
    createdAt: Date;
  }> = [];

  return {
    rows,
    async countSince(action, key, since) {
      return rows.filter(
        (row) =>
          row.action === action && row.key === key && row.createdAt >= since
      ).length;
    },
    async record(action, key) {
      rows.push({ action, key, createdAt: new Date() });
    },
    async tryRecord(action, key, since, limit) {
      const count = rows.filter(
        (row) =>
          row.action === action && row.key === key && row.createdAt >= since
      ).length;
      if (count >= limit) return false;
      rows.push({ action, key, createdAt: new Date() });
      return true;
    },
  };
}

test("login_email allows up to the configured limit, then blocks", async () => {
  const store = createFakeStore();
  const limit = AUTH_RATE_LIMIT_RULES.login_email.limit;

  for (let i = 0; i < limit; i++) {
    assert.equal(
      await isAuthRateLimited(store, "login_email", "user@example.com"),
      false,
      `attempt ${i + 1} should not be limited yet`
    );
    await recordAuthAttempt(store, "login_email", "user@example.com");
  }

  assert.equal(
    await isAuthRateLimited(store, "login_email", "user@example.com"),
    true
  );
});

test("login_ip allows up to the configured limit, then blocks", async () => {
  const store = createFakeStore();
  const limit = AUTH_RATE_LIMIT_RULES.login_ip.limit;

  for (let i = 0; i < limit; i++) {
    await recordAuthAttempt(store, "login_ip", "203.0.113.5");
  }

  assert.equal(await isAuthRateLimited(store, "login_ip", "203.0.113.5"), true);
});

test("signup_ip allows up to the configured limit, then blocks", async () => {
  const store = createFakeStore();
  const limit = AUTH_RATE_LIMIT_RULES.signup_ip.limit;

  for (let i = 0; i < limit; i++) {
    await recordAuthAttempt(store, "signup_ip", "203.0.113.9");
  }

  assert.equal(
    await isAuthRateLimited(store, "signup_ip", "203.0.113.9"),
    true
  );
});

test("forgot_password_email allows up to the configured limit, then blocks", async () => {
  const store = createFakeStore();
  const limit = AUTH_RATE_LIMIT_RULES.forgot_password_email.limit;

  for (let i = 0; i < limit; i++) {
    await recordAuthAttempt(
      store,
      "forgot_password_email",
      "victim@example.com"
    );
  }

  assert.equal(
    await isAuthRateLimited(
      store,
      "forgot_password_email",
      "victim@example.com"
    ),
    true
  );
});

test("a window expiry lifts the limit once old attempts age out", async () => {
  const store = createFakeStore();
  const rule = AUTH_RATE_LIMIT_RULES.login_email;
  const now = new Date();

  // Fill the store with attempts that are just past the window.
  for (let i = 0; i < rule.limit; i++) {
    store.rows.push({
      action: "login_email",
      key: "stale@example.com",
      createdAt: new Date(now.getTime() - rule.windowMs - 1000),
    });
  }

  assert.equal(
    await isAuthRateLimited(store, "login_email", "stale@example.com", now),
    false,
    "attempts outside the window must not count toward the limit"
  );
});

test("a window still in effect keeps the limit enforced", async () => {
  const store = createFakeStore();
  const rule = AUTH_RATE_LIMIT_RULES.login_email;
  const now = new Date();

  for (let i = 0; i < rule.limit; i++) {
    store.rows.push({
      action: "login_email",
      key: "recent@example.com",
      createdAt: new Date(now.getTime() - rule.windowMs + 1000),
    });
  }

  assert.equal(
    await isAuthRateLimited(store, "login_email", "recent@example.com", now),
    true,
    "attempts still inside the window must count toward the limit"
  );
});

test("different keys never share a rate-limit budget", async () => {
  const store = createFakeStore();
  const limit = AUTH_RATE_LIMIT_RULES.login_email.limit;

  for (let i = 0; i < limit; i++) {
    await recordAuthAttempt(store, "login_email", "attacker@example.com");
  }

  assert.equal(
    await isAuthRateLimited(store, "login_email", "attacker@example.com"),
    true
  );
  assert.equal(
    await isAuthRateLimited(store, "login_email", "innocent@example.com"),
    false,
    "a different email's own budget must be untouched"
  );
});

test("different actions never share a rate-limit budget even with the same key value", async () => {
  const store = createFakeStore();
  const sharedValue = "203.0.113.42";
  const ipLimit = AUTH_RATE_LIMIT_RULES.login_ip.limit;

  for (let i = 0; i < ipLimit; i++) {
    await recordAuthAttempt(store, "login_ip", sharedValue);
  }

  assert.equal(await isAuthRateLimited(store, "login_ip", sharedValue), true);
  assert.equal(
    await isAuthRateLimited(store, "signup_ip", sharedValue),
    false,
    "login_ip attempts must not count toward signup_ip's separate budget"
  );
});

test("tryRecordAuthAttempt allows up to the configured limit, then blocks, without a separate record() call", async () => {
  const store = createFakeStore();
  const limit = AUTH_RATE_LIMIT_RULES.polar_checkout_org.limit;
  const organizationId = "org_atomic";

  for (let i = 0; i < limit; i++) {
    assert.equal(
      await tryRecordAuthAttempt(store, "polar_checkout_org", organizationId),
      true,
      `attempt ${i + 1} should be allowed and recorded`
    );
  }

  assert.equal(
    await tryRecordAuthAttempt(store, "polar_checkout_org", organizationId),
    false,
    "the limit-th+1 attempt must be blocked and not recorded"
  );
  assert.equal(
    store.rows.filter(
      (row) => row.action === "polar_checkout_org" && row.key === organizationId
    ).length,
    limit,
    "a blocked attempt must not add a row"
  );
});

test("parseClientIpFromHeaderValues prefers the first x-forwarded-for entry", () => {
  const result = parseClientIpFromHeaderValues(
    "203.0.113.1, 10.0.0.1, 10.0.0.2",
    null
  );
  assert.equal(result, "203.0.113.1");
});

test("parseClientIpFromHeaderValues falls back to x-real-ip when x-forwarded-for is absent", () => {
  const result = parseClientIpFromHeaderValues(null, "198.51.100.7");
  assert.equal(result, "198.51.100.7");
});

test("parseClientIpFromHeaderValues returns null when neither header is present", () => {
  const result = parseClientIpFromHeaderValues(null, null);
  assert.equal(result, null);
});

test("parseClientIpFromHeaderValues returns null for blank/whitespace-only headers", () => {
  const result = parseClientIpFromHeaderValues("   ", "  ");
  assert.equal(result, null);
});

test("polar_checkout_org allows up to the configured limit, then blocks", async () => {
  const store = createFakeStore();
  const limit = AUTH_RATE_LIMIT_RULES.polar_checkout_org.limit;
  const organizationId = "org_1";

  for (let i = 0; i < limit; i++) {
    assert.equal(
      await isAuthRateLimited(store, "polar_checkout_org", organizationId),
      false,
      `attempt ${i + 1} should not be limited yet`
    );
    await recordAuthAttempt(store, "polar_checkout_org", organizationId);
  }

  assert.equal(
    await isAuthRateLimited(store, "polar_checkout_org", organizationId),
    true
  );
});

test("billing_portal_org allows up to the configured limit, then blocks", async () => {
  const store = createFakeStore();
  const limit = AUTH_RATE_LIMIT_RULES.billing_portal_org.limit;
  const organizationId = "org_2";

  for (let i = 0; i < limit; i++) {
    await recordAuthAttempt(store, "billing_portal_org", organizationId);
  }

  assert.equal(
    await isAuthRateLimited(store, "billing_portal_org", organizationId),
    true
  );
});

test("change_plan_org allows up to the configured limit, then blocks", async () => {
  const store = createFakeStore();
  const limit = AUTH_RATE_LIMIT_RULES.change_plan_org.limit;
  const organizationId = "org_3";

  for (let i = 0; i < limit; i++) {
    await recordAuthAttempt(store, "change_plan_org", organizationId);
  }

  assert.equal(
    await isAuthRateLimited(store, "change_plan_org", organizationId),
    true
  );
});

test("billing rate-limit actions never share a budget with each other for the same organization", async () => {
  const store = createFakeStore();
  const organizationId = "org_shared";
  const checkoutLimit = AUTH_RATE_LIMIT_RULES.polar_checkout_org.limit;

  for (let i = 0; i < checkoutLimit; i++) {
    await recordAuthAttempt(store, "polar_checkout_org", organizationId);
  }

  assert.equal(
    await isAuthRateLimited(store, "polar_checkout_org", organizationId),
    true
  );
  assert.equal(
    await isAuthRateLimited(store, "change_plan_org", organizationId),
    false,
    "checkout attempts must not count toward change_plan_org's separate budget"
  );
});
