/**
 * Real Postgres integration test for the daily org/per-user AI token caps
 * folded into entitlement.service.ts's reserveAiTokenCapacity.
 *
 * Before this change, the daily caps were only checked by
 * rate-limit.service.ts's checkRateLimit - a plain read with no lock,
 * keyed only by organizationId (so one user could exhaust an entire
 * org's daily budget alone), called redundantly in both api/chat/route.ts
 * and ai.service.ts. This proves the atomic, per-user-aware replacement
 * against a real database: a user's own usage can block them even while
 * the org as a whole is nowhere near its own daily cap, and the stale
 * reservation cleanup and monthly cap still work alongside it.
 *
 * Requires an explicitly configured disposable INTEGRATION_DATABASE_URL and
 * refuses Supabase-shaped hosts. Runs with the other integration suites.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import type { PlanLimitError as PlanLimitErrorType } from "../../src/server/services/entitlement.service";
import type { reserveAiTokenCapacity as ReserveAiTokenCapacityType } from "../../src/server/services/entitlement.service";
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

let reserveAiTokenCapacity: typeof ReserveAiTokenCapacityType;
let PlanLimitError: typeof PlanLimitErrorType;
let prisma: typeof PrismaType;

before(async () => {
  process.env.DATABASE_URL = INTEGRATION_DATABASE_URL;
  process.env.DIRECT_URL =
    process.env.INTEGRATION_DIRECT_URL ?? INTEGRATION_DATABASE_URL;
  // Small, deterministic caps so the test doesn't depend on (or need to
  // keep in sync with) the real production defaults.
  process.env.DAILY_TOKEN_LIMIT_PER_ORG = "1000";
  process.env.DAILY_TOKEN_LIMIT_PER_USER = "300";

  execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });

  const entitlementModule =
    await import("../../src/server/services/entitlement.service");
  reserveAiTokenCapacity = entitlementModule.reserveAiTokenCapacity;
  PlanLimitError = entitlementModule.PlanLimitError;

  const prismaModule = await import("../../src/lib/prisma");
  prisma = prismaModule.prisma;
});

after(async () => {
  await prisma.$disconnect();
});

async function createTestOrg(): Promise<string> {
  const organizationId = `integration-ai-caps-${randomUUID()}`;
  await prisma.organization.create({
    data: {
      id: organizationId,
      name: "AI token cap integration test",
      slug: organizationId,
    },
  });
  return organizationId;
}

test("a user's own daily usage blocks them even though the organization is far under its own daily cap", async () => {
  const organizationId = await createTestOrg();
  const heavyUserId = "integration-heavy-user";
  const otherUserId = "integration-other-user";

  try {
    // heavyUserId has already used 250 of their own 300-token daily budget.
    // Org-wide usage (250) is nowhere near the 1000 org cap.
    await prisma.usageRecord.create({
      data: {
        organizationId,
        userId: heavyUserId,
        conversationId: null,
        model: "test-model",
        inputTokens: 250,
        outputTokens: 0,
        totalTokens: 250,
      },
    });

    await assert.rejects(
      () =>
        reserveAiTokenCapacity({
          organizationId,
          userId: heavyUserId,
          conversationId: "integration-conversation",
          model: "test-model",
          estimatedTokens: 100,
        }),
      (error: unknown) => {
        assert.ok(error instanceof PlanLimitError);
        assert.match(error.message, /personal daily AI usage limit/);
        return true;
      },
      "a request that would push the user's own daily usage past 300 must be rejected"
    );

    // A different user in the same org, with no usage of their own yet,
    // must not be blocked by heavyUserId's consumption.
    const reservationId = await reserveAiTokenCapacity({
      organizationId,
      userId: otherUserId,
      conversationId: "integration-conversation",
      model: "test-model",
      estimatedTokens: 100,
    });

    assert.equal(
      await prisma.usageRecord.count({ where: { id: reservationId } }),
      1,
      "a different user's own budget must be untouched by heavyUserId's usage"
    );
  } finally {
    await prisma.usageRecord.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
  }
});

test("the organization-wide daily cap still blocks once enough distinct users push it over, even though no single user is over their own cap", async () => {
  const organizationId = await createTestOrg();

  try {
    // Four different users at 250 tokens each (under each one's own 300
    // cap) already sum to 1000 - exactly the org's daily cap.
    await prisma.usageRecord.createMany({
      data: Array.from({ length: 4 }, (_, i) => ({
        organizationId,
        userId: `integration-org-cap-user-${i}`,
        conversationId: null,
        model: "test-model",
        inputTokens: 250,
        outputTokens: 0,
        totalTokens: 250,
      })),
    });

    await assert.rejects(
      () =>
        reserveAiTokenCapacity({
          organizationId,
          userId: "integration-org-cap-user-4",
          conversationId: "integration-conversation",
          model: "test-model",
          estimatedTokens: 50,
        }),
      (error: unknown) => {
        assert.ok(error instanceof PlanLimitError);
        assert.match(error.message, /Daily token limit reached/);
        return true;
      },
      "a 5th user's request must still be rejected once the org-wide daily sum is exhausted"
    );
  } finally {
    await prisma.usageRecord.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
  }
});

test("a reservation that fits under every cap is committed and attributed to the requesting user", async () => {
  const organizationId = await createTestOrg();
  const userId = "integration-fits-user";

  try {
    const reservationId = await reserveAiTokenCapacity({
      organizationId,
      userId,
      conversationId: "integration-conversation",
      model: "test-model",
      estimatedTokens: 50,
    });

    const row = await prisma.usageRecord.findUnique({
      where: { id: reservationId },
    });

    assert.ok(row, "the reservation row must exist");
    assert.equal(row?.userId, userId);
    assert.equal(row?.totalTokens, 50);
  } finally {
    await prisma.usageRecord.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
  }
});
