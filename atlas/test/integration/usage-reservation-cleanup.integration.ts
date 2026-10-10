/**
 * Real Postgres integration test for on-demand stale AI-token reservation
 * cleanup. The scheduled sweep is a backstop, but a daily schedule must not
 * leave a dead request's placeholder consuming quota until the next day.
 *
 * Requires an explicitly configured disposable INTEGRATION_DATABASE_URL and
 * refuses Supabase-shaped hosts. Runs with the other integration suites.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

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

if (/supabase\\.co/i.test(INTEGRATION_DATABASE_URL)) {
  console.error(
    "INTEGRATION_DATABASE_URL looks like a Supabase (production-shaped) host - refusing to run."
  );
  process.exit(1);
}

let reserveAiTokenCapacity: typeof ReserveAiTokenCapacityType;
let prisma: typeof PrismaType;

before(async () => {
  process.env.DATABASE_URL = INTEGRATION_DATABASE_URL;
  process.env.DIRECT_URL =
    process.env.INTEGRATION_DIRECT_URL ?? INTEGRATION_DATABASE_URL;

  execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });

  const entitlementModule =
    await import("../../src/server/services/entitlement.service");
  reserveAiTokenCapacity = entitlementModule.reserveAiTokenCapacity;

  const prismaModule = await import("../../src/lib/prisma");
  prisma = prismaModule.prisma;
});

after(async () => {
  await prisma.$disconnect();
});

test("new AI reservation clears only this organization's stale placeholders before checking capacity", async () => {
  const organizationId = `integration-reservation-cleanup-${randomUUID()}`;
  const staleId = randomUUID();
  const freshId = randomUUID();
  const staleCreatedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const freshCreatedAt = new Date(Date.now() - 5 * 60 * 1000);

  await prisma.organization.create({
    data: {
      id: organizationId,
      name: "Reservation cleanup integration test",
      slug: organizationId,
    },
  });

  try {
    await prisma.usageRecord.createMany({
      data: [
        {
          id: staleId,
          organizationId,
          userId: "integration-user",
          conversationId: null,
          model: "test-model",
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 100,
          createdAt: staleCreatedAt,
        },
        {
          id: freshId,
          organizationId,
          userId: "integration-user",
          conversationId: null,
          model: "test-model",
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 100,
          createdAt: freshCreatedAt,
        },
      ],
    });

    const newReservationId = await reserveAiTokenCapacity({
      organizationId,
      userId: "integration-user",
      conversationId: "integration-conversation",
      model: "test-model",
      estimatedTokens: 100,
    });

    assert.equal(
      await prisma.usageRecord.count({ where: { id: staleId } }),
      0,
      "a reservation older than the 60-minute safety window must be removed"
    );
    assert.equal(
      await prisma.usageRecord.count({ where: { id: freshId } }),
      1,
      "a recent in-flight reservation must remain untouched"
    );
    assert.equal(
      await prisma.usageRecord.count({ where: { id: newReservationId } }),
      1,
      "the new reservation must be committed after cleanup"
    );
  } finally {
    await prisma.organization.deleteMany({ where: { id: organizationId } });
  }
});
