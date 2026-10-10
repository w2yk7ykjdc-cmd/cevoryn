/**
 * Real Postgres integration test for the onboarding duplicate-organization
 * race condition fix in organization.service.ts's createOrganization.
 *
 * Before this change, the "doesn't already belong to an org" check and the
 * org+member insert shared a transaction but nothing serialized two
 * concurrent transactions for the same user - Member's only unique
 * constraint is (userId, organizationId), and each concurrent onboarding
 * submission creates a *different* organizationId, so the database itself
 * never rejected the second insert. A double-click, a client retry after a
 * slow response, or two open onboarding tabs could create two
 * organizations (and two OWNER memberships) for one user.
 *
 * The functional tests below prove createOrganization behaves correctly,
 * but two "concurrent" JS promises hitting a fast local Postgres rarely
 * land close enough in time to actually exercise the race window on their
 * own - the last test proves the load-bearing mechanism directly and
 * deterministically: that a Postgres advisory lock on the same key
 * createOrganization uses genuinely blocks a second transaction until the
 * first commits, using pg_sleep to force real overlap instead of hoping
 * two `await`s happen to interleave.
 *
 * Requires an explicitly configured disposable INTEGRATION_DATABASE_URL and
 * refuses Supabase-shaped hosts. Runs with the other integration suites.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { Prisma } from "@prisma/client";

import type { createOrganization as CreateOrganizationType } from "../../src/server/services/organization.service";
import type { prisma as PrismaType } from "../../src/lib/prisma";

const INTEGRATION_DATABASE_URL = process.env.INTEGRATION_DATABASE_URL;

if (!INTEGRATION_DATABASE_URL) {
  console.error(
    "\nINTEGRATION_DATABASE_URL is not set.\n" +
      "This suite requires a real, disposable local Postgres database and must never point at production.\n"
  );
  process.exit(1);
}

if (/supabase\.co/i.test(INTEGRATION_DATABASE_URL)) {
  console.error(
    "INTEGRATION_DATABASE_URL looks like a Supabase (production-shaped) host - refusing to run."
  );
  process.exit(1);
}

let createOrganization: typeof CreateOrganizationType;
let prisma: typeof PrismaType;

before(async () => {
  process.env.DATABASE_URL = INTEGRATION_DATABASE_URL;
  process.env.DIRECT_URL =
    process.env.INTEGRATION_DIRECT_URL ?? INTEGRATION_DATABASE_URL;

  execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });

  const organizationModule =
    await import("../../src/server/services/organization.service");
  createOrganization = organizationModule.createOrganization;

  const prismaModule = await import("../../src/lib/prisma");
  prisma = prismaModule.prisma;
});

after(async () => {
  await prisma.$disconnect();
});

async function cleanupUser(userId: string): Promise<void> {
  const memberships = await prisma.member.findMany({
    where: { userId },
    select: { organizationId: true },
  });
  await prisma.member.deleteMany({ where: { userId } });
  await prisma.organization.deleteMany({
    where: { id: { in: memberships.map((m) => m.organizationId) } },
  });
}

test("createOrganization creates an organization and an OWNER member for a fresh user", async () => {
  const userId = `integration-org-create-${randomUUID()}`;

  try {
    const organization = await createOrganization({
      name: "Fresh User Org",
      createdByUserId: userId,
      displayName: "Fresh User",
    });

    assert.equal(organization.members.length, 1);
    assert.equal(organization.members[0]?.userId, userId);
    assert.equal(organization.members[0]?.role, "OWNER");

    const memberCount = await prisma.member.count({ where: { userId } });
    assert.equal(memberCount, 1);
  } finally {
    await cleanupUser(userId);
  }
});

test("createOrganization rejects a user who already belongs to an organization", async () => {
  const userId = `integration-org-create-${randomUUID()}`;

  try {
    await createOrganization({
      name: "First Org",
      createdByUserId: userId,
      displayName: "First Org Owner",
    });

    await assert.rejects(
      () =>
        createOrganization({
          name: "Second Org",
          createdByUserId: userId,
          displayName: "First Org Owner",
        }),
      /User already belongs to an organization/
    );

    const memberCount = await prisma.member.count({ where: { userId } });
    assert.equal(
      memberCount,
      1,
      "the rejected second attempt must not leave behind a second membership"
    );
  } finally {
    await cleanupUser(userId);
  }
});

test("two concurrent createOrganization calls for the same brand-new user: exactly one succeeds", async () => {
  const userId = `integration-org-create-${randomUUID()}`;

  try {
    const results = await Promise.allSettled([
      createOrganization({
        name: "Concurrent Org A",
        createdByUserId: userId,
        displayName: "Concurrent User",
      }),
      createOrganization({
        name: "Concurrent Org B",
        createdByUserId: userId,
        displayName: "Concurrent User",
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    assert.equal(
      fulfilled.length,
      1,
      "exactly one of the two concurrent onboarding attempts must succeed"
    );
    assert.equal(rejected.length, 1);
    assert.match(
      (rejected[0] as PromiseRejectedResult).reason.message,
      /User already belongs to an organization/
    );

    const memberships = await prisma.member.findMany({ where: { userId } });
    assert.equal(
      memberships.length,
      1,
      "the user must end up with exactly one membership, not two"
    );

    const organizationCount = await prisma.organization.count({
      where: { id: memberships[0]?.organizationId },
    });
    assert.equal(organizationCount, 1);
  } finally {
    await cleanupUser(userId);
  }
});

test("the advisory lock createOrganization relies on genuinely blocks a second transaction holding the same key", async () => {
  const lockKey = `create-organization:integration-lock-probe-${randomUUID()}`;
  const timeline: string[] = [];

  const holder = prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0)) IS NULL AS lock_acquired
    `);
    timeline.push("holder-acquired");
    // Holds the lock open for a while, long enough that a second
    // transaction attempting the same key is guaranteed to arrive and
    // have to wait, rather than racing to get there first.
    await tx.$queryRaw(Prisma.sql`SELECT pg_sleep(0.4) IS NULL AS slept`);
    timeline.push("holder-releasing");
  });

  // Give the holder a head start so it is certain to acquire the lock
  // first; the waiter is started only once that's true.
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(timeline, ["holder-acquired"]);

  const waiter = prisma.$transaction(async (tx) => {
    timeline.push("waiter-requesting");
    await tx.$queryRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0)) IS NULL AS lock_acquired
    `);
    timeline.push("waiter-acquired");
  });

  await Promise.all([holder, waiter]);

  assert.deepEqual(
    timeline,
    ["holder-acquired", "waiter-requesting", "holder-releasing", "waiter-acquired"],
    "the waiter must not acquire the lock until the holder's transaction has finished"
  );
});
