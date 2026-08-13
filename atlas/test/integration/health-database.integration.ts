/**
 * Real Postgres integration test for the migration-status reporting added
 * to /api/health/database (src/app/api/health/database/route.ts) - this is
 * the "proof a deploy actually ran migrations" check requested alongside
 * the billing hardening work. Directly manipulates `_prisma_migrations`
 * rows to reproduce both the healthy state and the exact "unfinished
 * migration" state production hit once (P3009/P3018), then calls the real
 * exported `GET` handler and asserts on its real JSON response - not
 * asserted by inspection alone.
 *
 * Same safety rules as polar-webhook.integration.ts: requires
 * INTEGRATION_DATABASE_URL explicitly, refuses anything supabase.co-shaped,
 * excluded from default `npm test` by not matching *.test.ts, run via
 * `npm run test:integration`.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { after, before, test } from "node:test";

import type { GET as GetType } from "../../src/app/api/health/database/route";
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

let GET: typeof GetType;
let prisma: typeof PrismaType;

before(async () => {
  process.env.DATABASE_URL = INTEGRATION_DATABASE_URL;
  process.env.DIRECT_URL =
    process.env.INTEGRATION_DIRECT_URL ?? INTEGRATION_DATABASE_URL;

  execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });

  const routeModule = await import("../../src/app/api/health/database/route");
  GET = routeModule.GET;

  const prismaModule = await import("../../src/lib/prisma");
  prisma = prismaModule.prisma;
});

after(async () => {
  await prisma.$disconnect();
});

test("a fully-migrated database reports schemaReady=true and an empty unfinished list", async () => {
  const response = await GET();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.schemaReady, true);
  assert.ok(body.migrations, "migrations field must be populated");
  assert.equal(body.migrations.unfinished.length, 0);
  assert.ok(
    body.migrations.appliedCount >= 7,
    "all 7 committed migrations (or more, if new ones were added) must be counted as applied"
  );
  assert.equal(typeof body.migrations.latestApplied, "string");
});

test("a migration left with no finished_at (the real P3009/P3018 production state) is reported in unfinished", async () => {
  const target = "20260812120000_add_polar_billing_provider";

  await prisma.$executeRaw`
    UPDATE "_prisma_migrations" SET "finished_at" = NULL WHERE "migration_name" = ${target}
  `;

  try {
    const response = await GET();
    const body = await response.json();

    assert.equal(
      response.status,
      200,
      "the health endpoint itself must stay reachable even with a broken migration state"
    );
    assert.deepEqual(body.migrations.unfinished, [target]);
    assert.ok(
      !body.migrations.unfinished.includes(
        "20260811080000_add_auth_rate_limit_attempts"
      ),
      "only the actually-unfinished migration should be reported, not every migration"
    );
  } finally {
    // Always restore, even if an assertion above throws - this database
    // gets reused by the other integration test files in the same run.
    await prisma.$executeRaw`
      UPDATE "_prisma_migrations"
      SET "finished_at" = "started_at"
      WHERE "migration_name" = ${target} AND "finished_at" IS NULL
    `;
  }
});
