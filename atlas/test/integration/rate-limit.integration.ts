/**
 * Real Postgres integration test for the rate-limit protection added to
 * POST /api/billing/{polar/checkout,portal,change-plan}. The existing
 * test/auth-rate-limit.test.ts only exercises the pure window/limit
 * algorithm against an in-memory fake store - it never proves the real,
 * Prisma-backed store (auth-rate-limit.service.ts, which is what those
 * three routes actually call) persists and enforces limits correctly
 * against a real "auth_rate_limit_attempts" table.
 *
 * This does not attempt to call the route handlers themselves - doing so
 * would require faking a full Supabase auth session, which is out of
 * proportion to what's being verified here. Instead it calls the exact
 * same `isAuthRateLimited`/`recordAuthAttempt` functions the routes call,
 * for the same three action names, against a real database - proving the
 * persistence layer those routes depend on actually works.
 *
 * Same safety rules as the other integration suites: requires
 * INTEGRATION_DATABASE_URL explicitly, refuses anything supabase.co-shaped,
 * excluded from default `npm test`, run via `npm run test:integration`.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import type {
  isAuthRateLimited as IsAuthRateLimitedType,
  recordAuthAttempt as RecordAuthAttemptType,
  tryRecordAuthAttempt as TryRecordAuthAttemptType,
} from "../../src/server/services/auth-rate-limit.service";
import { AUTH_RATE_LIMIT_RULES } from "../../src/server/services/auth-rate-limit";
import type { prisma as PrismaType } from "../../src/lib/prisma";

const INTEGRATION_DATABASE_URL = process.env.INTEGRATION_DATABASE_URL;

if (!INTEGRATION_DATABASE_URL) {
  console.error(
    "\nINTEGRATION_DATABASE_URL is not set.\n" +
      "This suite requires a real, disposable local Postgres database - it must\n" +
      "never point at production. Example:\n\n" +
      "  INTEGRATION_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/cevoryn_integration_test \\\n" +
      "    npm run test:integration\n"
  );
  process.exit(1);
}

if (/supabase\.co/i.test(INTEGRATION_DATABASE_URL)) {
  console.error(
    "INTEGRATION_DATABASE_URL looks like a Supabase (production-shaped) host - refusing to run."
  );
  process.exit(1);
}

let isAuthRateLimited: typeof IsAuthRateLimitedType;
let recordAuthAttempt: typeof RecordAuthAttemptType;
let tryRecordAuthAttempt: typeof TryRecordAuthAttemptType;
let prisma: typeof PrismaType;

before(async () => {
  process.env.DATABASE_URL = INTEGRATION_DATABASE_URL;
  process.env.DIRECT_URL =
    process.env.INTEGRATION_DIRECT_URL ?? INTEGRATION_DATABASE_URL;

  execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });

  const serviceModule =
    await import("../../src/server/services/auth-rate-limit.service");
  isAuthRateLimited = serviceModule.isAuthRateLimited;
  recordAuthAttempt = serviceModule.recordAuthAttempt;
  tryRecordAuthAttempt = serviceModule.tryRecordAuthAttempt;

  const prismaModule = await import("../../src/lib/prisma");
  prisma = prismaModule.prisma;
});

after(async () => {
  await prisma.$disconnect();
});

for (const action of [
  "polar_checkout_org",
  "billing_portal_org",
  "change_plan_org",
] as const) {
  test(`${action}: the real DB-backed store blocks after the configured limit, against a real Postgres table`, async () => {
    const organizationId = `integration-test-org-${action}-${randomUUID().slice(0, 8)}`;
    const limit = AUTH_RATE_LIMIT_RULES[action].limit;

    for (let i = 0; i < limit; i++) {
      assert.equal(
        await isAuthRateLimited(action, organizationId),
        false,
        `attempt ${i + 1} should not be limited yet`
      );
      await recordAuthAttempt(action, organizationId);
    }

    assert.equal(
      await isAuthRateLimited(action, organizationId),
      true,
      "the limit-th+1 check must report limited, backed by real rows in auth_rate_limit_attempts"
    );

    const rows = await prisma.authRateLimitAttempt.count({
      where: { action, key: organizationId },
    });
    assert.equal(
      rows,
      limit,
      "exactly `limit` rows must have actually been persisted to Postgres"
    );

    await prisma.authRateLimitAttempt.deleteMany({
      where: { action, key: organizationId },
    });
  });
}

test("tryRecordAuthAttempt closes the check-then-act race: N truly concurrent attempts against a real limit allow exactly `limit` through", async () => {
  // The old isAuthRateLimited() + recordAuthAttempt() two-step pattern has
  // a TOCTOU window: under Postgres's default READ COMMITTED isolation,
  // concurrent callers can all observe "under the limit" before any of
  // them has inserted a row, letting more than `limit` attempts through.
  // This fires far more parallel requests than the limit, all at once
  // (no await between dispatch), against the real DB-backed
  // tryRecordAuthAttempt() - if the advisory-lock serialization in
  // auth-rate-limit.service.ts's tryRecord() didn't work, this would
  // observe more than `limit` "allowed" results and/or more than `limit`
  // persisted rows.
  const organizationId = `integration-test-org-concurrent-${randomUUID().slice(0, 8)}`;
  const limit = AUTH_RATE_LIMIT_RULES.polar_checkout_org.limit;
  const attemptCount = limit * 3;

  const results = await Promise.all(
    Array.from({ length: attemptCount }, () =>
      tryRecordAuthAttempt("polar_checkout_org", organizationId)
    )
  );

  const allowedCount = results.filter((allowed) => allowed).length;
  assert.equal(
    allowedCount,
    limit,
    `exactly ${limit} of ${attemptCount} truly concurrent attempts must be allowed, not more`
  );

  const rows = await prisma.authRateLimitAttempt.count({
    where: { action: "polar_checkout_org", key: organizationId },
  });
  assert.equal(
    rows,
    limit,
    "exactly `limit` rows must have actually been persisted, matching the allowed count"
  );

  await prisma.authRateLimitAttempt.deleteMany({
    where: { action: "polar_checkout_org", key: organizationId },
  });
});

test("different organizations never share a billing rate-limit budget in the real store", async () => {
  const orgA = `integration-test-org-a-${randomUUID().slice(0, 8)}`;
  const orgB = `integration-test-org-b-${randomUUID().slice(0, 8)}`;
  const limit = AUTH_RATE_LIMIT_RULES.polar_checkout_org.limit;

  for (let i = 0; i < limit; i++) {
    await recordAuthAttempt("polar_checkout_org", orgA);
  }

  assert.equal(await isAuthRateLimited("polar_checkout_org", orgA), true);
  assert.equal(
    await isAuthRateLimited("polar_checkout_org", orgB),
    false,
    "org B's own budget must be untouched by org A's attempts"
  );

  await prisma.authRateLimitAttempt.deleteMany({
    where: { action: "polar_checkout_org", key: { in: [orgA, orgB] } },
  });
});
