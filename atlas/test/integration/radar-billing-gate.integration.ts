/**
 * Real Postgres integration coverage for the P0 audit finding: 4 Radar GET
 * routes (opportunities, events, entities, company-profile) enforced RBAC
 * but never the RADAR billing feature - a `radar:read` member of a
 * downgraded/never-RADAR organization could read Radar data directly via
 * the API even though the UI itself would never surface it.
 *
 * The fix added the exact same
 * `assertOrganizationFeatureAccess(organizationId, "RADAR")` call (already
 * used by every Radar mutation route) to all 4 GET route handlers, right
 * after the existing RBAC check. Route handlers themselves aren't invoked
 * here - this codebase's integration suites consistently test at the
 * service/entitlement boundary rather than mocking Next.js request/auth
 * context (see opportunity-proprietary-data.integration.ts for the same
 * pattern) - so this exercises `assertOrganizationFeatureAccess` itself,
 * against real Subscription rows, which is exactly the call every one of
 * the 4 routes now makes before reaching its service layer.
 *
 * Same safety rules as every other suite in this directory: requires
 * INTEGRATION_DATABASE_URL explicitly, refuses anything supabase.co-shaped,
 * excluded from default `npm test`, run via `npm run test:integration`.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { FeatureAccessError } from "../../src/features/billing/config/plans";
import type { assertOrganizationFeatureAccess as AssertOrganizationFeatureAccessType } from "../../src/server/services/entitlement.service";
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
const RADAR_ORG_ID = `billing-gate-radar-org-${TEST_RUN_ID}`;
const STARTER_ORG_ID = `billing-gate-starter-org-${TEST_RUN_ID}`;
const DOWNGRADED_ORG_ID = `billing-gate-downgraded-org-${TEST_RUN_ID}`;

let prisma: typeof PrismaType;
let assertOrganizationFeatureAccess: typeof AssertOrganizationFeatureAccessType;

before(async () => {
  process.env.DATABASE_URL = INTEGRATION_DATABASE_URL;
  process.env.DIRECT_URL =
    process.env.INTEGRATION_DIRECT_URL ?? INTEGRATION_DATABASE_URL;

  execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });

  const prismaModule = await import("../../src/lib/prisma");
  prisma = prismaModule.prisma;

  const entitlementModule =
    await import("../../src/server/services/entitlement.service");
  assertOrganizationFeatureAccess =
    entitlementModule.assertOrganizationFeatureAccess;

  await prisma.organization.createMany({
    data: [
      {
        id: RADAR_ORG_ID,
        name: "Billing Gate RADAR Org",
        slug: `billing-gate-radar-${TEST_RUN_ID}`,
      },
      {
        id: STARTER_ORG_ID,
        name: "Billing Gate STARTER Org",
        slug: `billing-gate-starter-${TEST_RUN_ID}`,
      },
      {
        id: DOWNGRADED_ORG_ID,
        name: "Billing Gate Downgraded Org",
        slug: `billing-gate-downgraded-${TEST_RUN_ID}`,
      },
    ],
  });

  // RADAR_ORG_ID: real, active Professional-plan subscription.
  await prisma.subscription.create({
    data: {
      organizationId: RADAR_ORG_ID,
      stripeCustomerId: `stripe-cus-radar-${TEST_RUN_ID}`,
      plan: "PROFESSIONAL",
      subscriptionStatus: "ACTIVE",
    },
  });

  // STARTER_ORG_ID: deliberately no subscription row - matches the real
  // default-to-STARTER behavior getOrganizationEntitlements() already has
  // for an org with no active subscription, not a special-cased path.

  // DOWNGRADED_ORG_ID: a Professional subscription that is no longer
  // active (CANCELED) - proves a plan downgrade closes this gate too, not
  // just "never having RADAR at all".
  await prisma.subscription.create({
    data: {
      organizationId: DOWNGRADED_ORG_ID,
      stripeCustomerId: `stripe-cus-downgraded-${TEST_RUN_ID}`,
      plan: "PROFESSIONAL",
      subscriptionStatus: "CANCELED",
    },
  });
});

after(async () => {
  await prisma.organization.deleteMany({
    where: { id: { in: [RADAR_ORG_ID, STARTER_ORG_ID, DOWNGRADED_ORG_ID] } },
  });
  await prisma.$disconnect();
});

test("a RADAR-enabled organization passes the RADAR feature check every one of the 4 GET routes now performs", async () => {
  const plan = await assertOrganizationFeatureAccess(RADAR_ORG_ID, "RADAR");
  assert.equal(plan, "PROFESSIONAL");
});

test("a STARTER (never-RADAR) organization is rejected with FeatureAccessError - the same error every GET route now catches and turns into a 403", async () => {
  await assert.rejects(
    () => assertOrganizationFeatureAccess(STARTER_ORG_ID, "RADAR"),
    FeatureAccessError
  );
});

test("a downgraded organization (was RADAR, subscription now canceled) is rejected the same way - a plan downgrade actually closes the gate", async () => {
  await assert.rejects(
    () => assertOrganizationFeatureAccess(DOWNGRADED_ORG_ID, "RADAR"),
    FeatureAccessError
  );
});

test("tenant isolation: one organization's subscription never grants another organization RADAR access", async () => {
  // RADAR_ORG_ID's own subscription must not leak into a fresh org with no
  // subscription of its own.
  const freshOrgId = `billing-gate-fresh-org-${TEST_RUN_ID}`;
  await prisma.organization.create({
    data: {
      id: freshOrgId,
      name: "Billing Gate Fresh Org",
      slug: `billing-gate-fresh-${TEST_RUN_ID}`,
    },
  });

  await assert.rejects(
    () => assertOrganizationFeatureAccess(freshOrgId, "RADAR"),
    FeatureAccessError
  );

  await prisma.organization.delete({ where: { id: freshOrgId } });
});
