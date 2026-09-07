/**
 * Regression coverage for the production incident where the dashboard's
 * onboarding-progress check crashed the entire dashboard for every
 * organization because its raw `google_connections` query had no error
 * handling and that table had been dropped by an unrelated migration (see
 * the GoogleConnection model's comment in schema.prisma).
 *
 * countGoogleConnections() (src/lib/google-connection.ts) is what
 * loadExecutiveHome() now calls instead of running the raw query inline -
 * isolated specifically so this fallback behavior is directly testable
 * without needing loadExecutiveHome's Next.js request context
 * (next-intl/cookies()), which a plain script can't provide.
 *
 * This suite exercises it against a real database in the three states
 * that matter: no connection row, a connection row present, and -
 * reproducing the actual incident - the table itself missing. The third
 * case is the one that actually broke in production and had zero test
 * coverage before this file.
 *
 * Same safety rules as the other integration suites: requires
 * INTEGRATION_DATABASE_URL explicitly, refuses anything supabase.co-shaped,
 * excluded from default `npm test`, run via `npm run test:integration`.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import type { countGoogleConnections as CountGoogleConnectionsType } from "../../src/lib/google-connection";
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

const TEST_RUN_ID = randomUUID().slice(0, 8);
const ORG_ID = `dash-resilience-org-${TEST_RUN_ID}`;
const USER_ID = `dash-resilience-user-${TEST_RUN_ID}`;

let prisma: typeof PrismaType;
let countGoogleConnections: typeof CountGoogleConnectionsType;

before(async () => {
  process.env.DATABASE_URL = INTEGRATION_DATABASE_URL;
  process.env.DIRECT_URL =
    process.env.INTEGRATION_DIRECT_URL ?? INTEGRATION_DATABASE_URL;

  execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });

  const prismaModule = await import("../../src/lib/prisma");
  prisma = prismaModule.prisma;

  const googleConnectionModule = await import("../../src/lib/google-connection");
  countGoogleConnections = googleConnectionModule.countGoogleConnections;

  await prisma.organization.create({
    data: {
      id: ORG_ID,
      name: "Dashboard Resilience Test Org",
      slug: `dash-resilience-${TEST_RUN_ID}`,
    },
  });
});

after(async () => {
  await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  await prisma.$disconnect();
});

test("countGoogleConnections returns 0 when no connection exists", async () => {
  const count = await countGoogleConnections(ORG_ID);
  assert.equal(count, 0);
});

test("countGoogleConnections returns 1 when a connection row exists", async () => {
  await prisma.googleConnection.create({
    data: {
      organizationId: ORG_ID,
      userId: USER_ID,
      googleEmail: "test@example.com",
      accessTokenEncrypted: "encrypted-access-token",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      scopes: "calendar.events",
    },
  });

  try {
    const count = await countGoogleConnections(ORG_ID);
    assert.equal(count, 1);
  } finally {
    await prisma.googleConnection.deleteMany({
      where: { organizationId: ORG_ID },
    });
  }
});

test("countGoogleConnections returns 0 instead of throwing when the google_connections table itself is missing - reproduces the actual production incident", async () => {
  // Simulate the exact failure mode that broke production: the table this
  // query depends on does not exist. Dropped and recreated only against
  // this disposable local database, inside try/finally so a failure here
  // can never leave the DB missing the table for later tests/runs.
  await prisma.$executeRawUnsafe(`DROP TABLE "google_connections"`);

  try {
    const count = await countGoogleConnections(ORG_ID);
    assert.equal(
      count,
      0,
      "a broken google_connections lookup must degrade to 0, not throw"
    );
  } finally {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "google_connections" (
        "id" TEXT NOT NULL,
        "organization_id" TEXT NOT NULL,
        "user_id" TEXT NOT NULL,
        "google_email" TEXT NOT NULL,
        "access_token_encrypted" TEXT NOT NULL,
        "refresh_token_encrypted" TEXT,
        "expires_at" TIMESTAMP(3) NOT NULL,
        "scopes" TEXT NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "google_connections_pkey" PRIMARY KEY ("id")
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "google_connections_organization_id_user_id_key"
        ON "google_connections"("organization_id", "user_id")
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "google_connections_organization_id_idx"
        ON "google_connections"("organization_id")
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "google_connections"
        ADD CONSTRAINT "google_connections_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    `);
  }
});
