/**
 * Real Postgres integration coverage for a gap found during a read-only
 * audit: createTrustEnvelope()'s default missingInformation list
 * (trust-engine.ts::detectMissingInfo) always claimed "Calendar
 * integration not connected" / "Email integration not connected"
 * regardless of whether the organization had actually connected Google -
 * a hardcoded stub despite its own comment claiming it "checks which data
 * connectors are active."
 *
 * The fix makes detectMissingInfo() genuinely check
 * countGoogleConnections() (the same real, resilient lookup already used
 * by the dashboard's onboarding-progress indicator - see
 * executive-home-google-connection-resilience.integration.ts) and clears
 * both the Calendar and Email entries together once any member has
 * connected Google (they share one OAuth connection in this codebase).
 * "Task management system not connected" is left in unconditionally -
 * there is genuinely no such integration anywhere in this codebase, so
 * that entry was never a stub to begin with.
 *
 * Same safety rules as every other suite in this directory: requires
 * INTEGRATION_DATABASE_URL explicitly, refuses anything supabase.co-shaped,
 * excluded from default `npm test`, run via `npm run test:integration`.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import type { createTrustEnvelope as CreateTrustEnvelopeType } from "../../src/features/brain/trust/trust-engine";
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
const DISCONNECTED_ORG_ID = `trust-missing-info-disconnected-${TEST_RUN_ID}`;
const CONNECTED_ORG_ID = `trust-missing-info-connected-${TEST_RUN_ID}`;
const USER_ID = `trust-missing-info-user-${TEST_RUN_ID}`;

let prisma: typeof PrismaType;
let createTrustEnvelope: typeof CreateTrustEnvelopeType;

before(async () => {
  process.env.DATABASE_URL = INTEGRATION_DATABASE_URL;
  process.env.DIRECT_URL =
    process.env.INTEGRATION_DIRECT_URL ?? INTEGRATION_DATABASE_URL;

  execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });

  const prismaModule = await import("../../src/lib/prisma");
  prisma = prismaModule.prisma;

  const trustEngineModule =
    await import("../../src/features/brain/trust/trust-engine");
  createTrustEnvelope = trustEngineModule.createTrustEnvelope;

  await prisma.organization.createMany({
    data: [
      {
        id: DISCONNECTED_ORG_ID,
        name: "Trust Missing-Info Disconnected Org",
        slug: `trust-missing-info-disconnected-${TEST_RUN_ID}`,
      },
      {
        id: CONNECTED_ORG_ID,
        name: "Trust Missing-Info Connected Org",
        slug: `trust-missing-info-connected-${TEST_RUN_ID}`,
      },
    ],
  });

  await prisma.googleConnection.create({
    data: {
      organizationId: CONNECTED_ORG_ID,
      userId: USER_ID,
      googleEmail: "test@example.com",
      accessTokenEncrypted: "encrypted-access-token",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      scopes: "calendar.events",
    },
  });
});

after(async () => {
  await prisma.organization.deleteMany({
    where: { id: { in: [DISCONNECTED_ORG_ID, CONNECTED_ORG_ID] } },
  });
  await prisma.$disconnect();
});

test("an organization with no Google connection still gets the Calendar/Email missing-info entries, plus the always-true Task-management one", async () => {
  const envelope = await createTrustEnvelope({
    data: { ok: true },
    evidence: [],
    reasoning: "test",
    organizationId: DISCONNECTED_ORG_ID,
  });

  assert.ok(
    envelope.missingInformation.includes("Calendar integration not connected")
  );
  assert.ok(
    envelope.missingInformation.includes("Email integration not connected")
  );
  assert.ok(
    envelope.missingInformation.includes("Task management system not connected")
  );
  assert.equal(envelope.missingInformation.length, 3);
});

test("an organization with a real Google connection no longer gets the stale Calendar/Email missing-info claims - only the genuinely-true task-management one remains", async () => {
  const envelope = await createTrustEnvelope({
    data: { ok: true },
    evidence: [],
    reasoning: "test",
    organizationId: CONNECTED_ORG_ID,
  });

  assert.deepEqual(envelope.missingInformation, [
    "Task management system not connected",
  ]);
});

test("an explicit missingInformation list always wins and never triggers the connector check at all", async () => {
  const envelope = await createTrustEnvelope({
    data: { ok: true },
    evidence: [],
    reasoning: "test",
    organizationId: DISCONNECTED_ORG_ID,
    missingInformation: ["Full AI analysis unavailable"],
  });

  assert.deepEqual(envelope.missingInformation, [
    "Full AI analysis unavailable",
  ]);
});

test("tenant isolation: one organization's Google connection never clears another organization's missing-info claim", async () => {
  const freshOrgId = `trust-missing-info-fresh-${TEST_RUN_ID}`;
  await prisma.organization.create({
    data: {
      id: freshOrgId,
      name: "Trust Missing-Info Fresh Org",
      slug: `trust-missing-info-fresh-${TEST_RUN_ID}`,
    },
  });

  const envelope = await createTrustEnvelope({
    data: { ok: true },
    evidence: [],
    reasoning: "test",
    organizationId: freshOrgId,
  });

  assert.ok(
    envelope.missingInformation.includes("Calendar integration not connected")
  );

  await prisma.organization.delete({ where: { id: freshOrgId } });
});
