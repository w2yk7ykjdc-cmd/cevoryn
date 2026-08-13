/**
 * Real Postgres integration test for the two retention/cleanup functions
 * added to stop auth_rate_limit_attempts and billing_webhook_events from
 * growing forever: cleanupStaleAuthRateLimitAttempts()
 * (auth-rate-limit.service.ts) and cleanupStaleBillingWebhookEvents()
 * (billing.service.ts), both wired into
 * /api/cron/cleanup-billing-hardening-records.
 *
 * Inserts rows with explicit, controlled `created_at` timestamps (some
 * inside the retention window, some past it) directly via raw SQL - not
 * through the app's normal insert paths, which always stamp "now" - then
 * asserts the real exported functions delete exactly the stale ones and
 * leave the fresh ones untouched.
 *
 * Same safety rules as the other integration suites: requires
 * INTEGRATION_DATABASE_URL explicitly, refuses anything supabase.co-shaped,
 * excluded from default `npm test`, run via `npm run test:integration`.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import type { cleanupStaleAuthRateLimitAttempts as CleanupAuthRateLimitAttemptsType } from "../../src/server/services/auth-rate-limit.service";
import type { cleanupStaleBillingWebhookEvents as CleanupBillingWebhookEventsType } from "../../src/server/services/billing.service";
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

let cleanupStaleAuthRateLimitAttempts: typeof CleanupAuthRateLimitAttemptsType;
let cleanupStaleBillingWebhookEvents: typeof CleanupBillingWebhookEventsType;
let prisma: typeof PrismaType;

before(async () => {
  process.env.DATABASE_URL = INTEGRATION_DATABASE_URL;
  process.env.DIRECT_URL =
    process.env.INTEGRATION_DIRECT_URL ?? INTEGRATION_DATABASE_URL;

  execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });

  const rateLimitModule =
    await import("../../src/server/services/auth-rate-limit.service");
  cleanupStaleAuthRateLimitAttempts =
    rateLimitModule.cleanupStaleAuthRateLimitAttempts;

  const billingModule = await import("../../src/server/services/billing.service");
  cleanupStaleBillingWebhookEvents =
    billingModule.cleanupStaleBillingWebhookEvents;

  const prismaModule = await import("../../src/lib/prisma");
  prisma = prismaModule.prisma;
});

after(async () => {
  await prisma.$disconnect();
});

test("cleanupStaleAuthRateLimitAttempts deletes rows past the retention window and keeps rows still inside their rate-limit window", async () => {
  const staleKey = `integration-test-cleanup-stale-${randomUUID().slice(0, 8)}`;
  const freshKey = `integration-test-cleanup-fresh-${randomUUID().slice(0, 8)}`;

  const staleTimestamp = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25h old
  const freshTimestamp = new Date(Date.now() - 10 * 60 * 1000); // 10m old

  await prisma.$executeRaw`
    INSERT INTO "auth_rate_limit_attempts" ("id", "action", "key", "created_at")
    VALUES (${randomUUID()}, 'login_email', ${staleKey}, ${staleTimestamp})
  `;
  await prisma.$executeRaw`
    INSERT INTO "auth_rate_limit_attempts" ("id", "action", "key", "created_at")
    VALUES (${randomUUID()}, 'login_email', ${freshKey}, ${freshTimestamp})
  `;

  try {
    const deletedCount = await cleanupStaleAuthRateLimitAttempts(24);
    assert.ok(
      deletedCount >= 1,
      "at least the one deliberately-stale row from this test must be deleted"
    );

    const staleRemaining = await prisma.authRateLimitAttempt.count({
      where: { key: staleKey },
    });
    assert.equal(staleRemaining, 0, "the 25h-old row must be deleted");

    const freshRemaining = await prisma.authRateLimitAttempt.count({
      where: { key: freshKey },
    });
    assert.equal(freshRemaining, 1, "the 10m-old row must survive");
  } finally {
    await prisma.authRateLimitAttempt.deleteMany({
      where: { key: { in: [staleKey, freshKey] } },
    });
  }
});

test("cleanupStaleBillingWebhookEvents deletes rows past the retention window and keeps rows still inside it", async () => {
  const staleEventId = `integration-test-cleanup-stale-${randomUUID()}`;
  const freshEventId = `integration-test-cleanup-fresh-${randomUUID()}`;

  const staleTimestamp = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000); // 31d old
  const freshTimestamp = new Date(Date.now() - 24 * 60 * 60 * 1000); // 1d old

  await prisma.$executeRaw`
    INSERT INTO "billing_webhook_events" ("provider", "event_id", "event_type", "created_at")
    VALUES ('polar', ${staleEventId}, 'subscription.active', ${staleTimestamp})
  `;
  await prisma.$executeRaw`
    INSERT INTO "billing_webhook_events" ("provider", "event_id", "event_type", "created_at")
    VALUES ('polar', ${freshEventId}, 'subscription.active', ${freshTimestamp})
  `;

  try {
    const deletedCount = await cleanupStaleBillingWebhookEvents(30);
    assert.ok(
      deletedCount >= 1,
      "at least the one deliberately-stale row from this test must be deleted"
    );

    const staleRemaining = await prisma.billingWebhookEvent.count({
      where: { eventId: staleEventId },
    });
    assert.equal(staleRemaining, 0, "the 31-day-old row must be deleted");

    const freshRemaining = await prisma.billingWebhookEvent.count({
      where: { eventId: freshEventId },
    });
    assert.equal(freshRemaining, 1, "the 1-day-old row must survive");
  } finally {
    await prisma.billingWebhookEvent.deleteMany({
      where: { eventId: { in: [staleEventId, freshEventId] } },
    });
  }
});
