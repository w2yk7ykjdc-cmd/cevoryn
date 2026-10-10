/**
 * Real Postgres regression test for concurrent team-invite capacity checks.
 *
 * Two invite requests run at the same time when only one plan slot remains.
 * Exactly one must commit; the other must observe the committed pending invite
 * after acquiring the organization-scoped advisory lock and reject.
 *
 * Requires a disposable local Postgres database and refuses Supabase-shaped
 * hosts. Run via `npm run test:integration`, never against production.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import type { prisma as PrismaType } from "../../src/lib/prisma";
import type {
  withMemberCapacityLock as WithMemberCapacityLockType,
  PlanLimitError as PlanLimitErrorType,
} from "../../src/server/services/entitlement.service";

const INTEGRATION_DATABASE_URL = process.env.INTEGRATION_DATABASE_URL;

if (!INTEGRATION_DATABASE_URL) {
  console.error(
    "\nINTEGRATION_DATABASE_URL is not set. This suite requires a disposable local Postgres database and must never point at production.\n"
  );
  process.exit(1);
}

if (/supabase\\.co/i.test(INTEGRATION_DATABASE_URL)) {
  console.error(
    "INTEGRATION_DATABASE_URL looks like a Supabase (production-shaped) host - refusing to run."
  );
  process.exit(1);
}

const TEST_RUN_ID = randomUUID().slice(0, 8);
const ORG_ID = `member-capacity-race-${TEST_RUN_ID}`;

let prisma: typeof PrismaType;
let withMemberCapacityLock: typeof WithMemberCapacityLockType;
let PlanLimitError: typeof PlanLimitErrorType;

before(async () => {
  process.env.DATABASE_URL = INTEGRATION_DATABASE_URL;
  process.env.DIRECT_URL =
    process.env.INTEGRATION_DIRECT_URL ?? INTEGRATION_DATABASE_URL;

  execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });

  const prismaModule = await import("../../src/lib/prisma");
  prisma = prismaModule.prisma;

  const entitlementModule =
    await import("../../src/server/services/entitlement.service");
  withMemberCapacityLock = entitlementModule.withMemberCapacityLock;
  PlanLimitError = entitlementModule.PlanLimitError;

  await prisma.organization.create({
    data: {
      id: ORG_ID,
      name: "Member Capacity Race Test",
      slug: `member-capacity-race-${TEST_RUN_ID}`,
    },
  });

  // No subscription means the organization uses the real Starter default.
  // Starter allows three members; two existing members leave one invite slot.
  await prisma.member.createMany({
    data: [
      {
        userId: `capacity-owner-${TEST_RUN_ID}`,
        organizationId: ORG_ID,
        role: "OWNER",
        displayName: "Capacity Owner",
      },
      {
        userId: `capacity-member-${TEST_RUN_ID}`,
        organizationId: ORG_ID,
        role: "MEMBER",
        displayName: "Capacity Member",
      },
    ],
  });
});

after(async () => {
  await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  await prisma.$disconnect();
});

test("concurrent invites cannot exceed the organization's member limit", async () => {
  const invite = (email: string) =>
    withMemberCapacityLock(ORG_ID, 1, (tx) =>
      tx.invite.create({
        data: {
          organizationId: ORG_ID,
          email,
          role: "MEMBER",
          invitedBy: `capacity-owner-${TEST_RUN_ID}`,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      })
    );

  const results = await Promise.allSettled([
    invite(`first-${TEST_RUN_ID}@example.com`),
    invite(`second-${TEST_RUN_ID}@example.com`),
  ]);

  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
    "exactly one invite should fit in the final available slot"
  );
  const rejected = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  );
  assert.equal(rejected.length, 1);
  assert.ok(rejected[0].reason instanceof PlanLimitError);

  const [memberCount, pendingInviteCount] = await Promise.all([
    prisma.member.count({ where: { organizationId: ORG_ID } }),
    prisma.invite.count({
      where: {
        organizationId: ORG_ID,
        status: "PENDING",
        expiresAt: { gt: new Date() },
      },
    }),
  ]);
  assert.equal(memberCount + pendingInviteCount, 3);
});
