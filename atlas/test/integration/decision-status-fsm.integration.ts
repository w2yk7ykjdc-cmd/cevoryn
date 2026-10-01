/**
 * Real Postgres integration coverage for a gap found during a read-only
 * audit: decision.service.ts::updateDecisionStatus() (the function the
 * shipped decision-queue.tsx UI actually calls, via PATCH
 * /api/brain/decisions/[id]) wrote the requested status unconditionally,
 * with no check against the decision's current status - so e.g. a
 * REJECTED (meant to be terminal) decision could still be moved straight
 * to COMPLETED, or a COMPLETED decision could be "accepted" again.
 *
 * The fix adds VALID_SOURCE_STATUSES, scoped to the 4 statuses this
 * function's own signature can set (ACCEPTED/REJECTED/IGNORED/COMPLETED -
 * not the full 9-state DECISION_LIFECYCLE FSM in outcomes/types.ts, which
 * includes EXECUTED/SUCCESSFUL/FAILED/UNKNOWN that no shipped UI path
 * ever reaches), and enforces it via an optimistic-concurrency
 * `updateMany` that only succeeds when the decision's current status is
 * one of the allowed source statuses for the requested target.
 *
 * Same safety rules as every other suite in this directory: requires
 * INTEGRATION_DATABASE_URL explicitly, refuses anything supabase.co-shaped,
 * excluded from default `npm test`, run via `npm run test:integration`.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import type { updateDecisionStatus as UpdateDecisionStatusType } from "../../src/features/brain/decisions/decision.service";
import type { prisma as PrismaType } from "../../src/lib/prisma";
import type { DecisionCanvas } from "../../src/features/brain/decisions/types";

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
const ORG_ID = `decision-fsm-org-${TEST_RUN_ID}`;

let prisma: typeof PrismaType;
let updateDecisionStatus: typeof UpdateDecisionStatusType;

function testCanvas(): DecisionCanvas {
  return {
    executiveSummary: "test",
    problemStatement: "test problem",
    evidence: [],
    possibleCauses: [],
    businessImpact: "test",
    priorityScore: 5,
    scoringBreakdown: [],
    options: [],
    recommendedDecision: "test",
    confidenceScore: 0.7,
    expectedOutcome: "test",
    followUpPlan: [],
  };
}

before(async () => {
  process.env.DATABASE_URL = INTEGRATION_DATABASE_URL;
  process.env.DIRECT_URL =
    process.env.INTEGRATION_DIRECT_URL ?? INTEGRATION_DATABASE_URL;

  execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });

  const prismaModule = await import("../../src/lib/prisma");
  prisma = prismaModule.prisma;

  const decisionModule =
    await import("../../src/features/brain/decisions/decision.service");
  updateDecisionStatus = decisionModule.updateDecisionStatus;

  await prisma.organization.create({
    data: {
      id: ORG_ID,
      name: "Decision FSM Test Org",
      slug: `decision-fsm-${TEST_RUN_ID}`,
    },
  });
});

after(async () => {
  await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  await prisma.$disconnect();
});

async function createTestDecision() {
  return prisma.decision.create({
    data: {
      organizationId: ORG_ID,
      canvas: testCanvas() as never,
      priorityScore: 5,
    },
  });
}

test("the real shipped flow (PROPOSED -> ACCEPTED -> COMPLETED) is allowed", async () => {
  const decision = await createTestDecision();

  assert.equal(
    await updateDecisionStatus(ORG_ID, decision.id, "ACCEPTED"),
    true
  );
  assert.equal(
    await updateDecisionStatus(ORG_ID, decision.id, "COMPLETED", "done"),
    true
  );

  const final = await prisma.decision.findUniqueOrThrow({
    where: { id: decision.id },
  });
  assert.equal(final.status, "COMPLETED");
});

test("REJECTED is terminal: a rejected decision can never be moved to COMPLETED", async () => {
  const decision = await createTestDecision();
  assert.equal(
    await updateDecisionStatus(ORG_ID, decision.id, "REJECTED"),
    true
  );

  const blocked = await updateDecisionStatus(
    ORG_ID,
    decision.id,
    "COMPLETED",
    "should not apply"
  );
  assert.equal(blocked, false);

  const final = await prisma.decision.findUniqueOrThrow({
    where: { id: decision.id },
  });
  assert.equal(final.status, "REJECTED");
  assert.equal(final.outcome, null);
});

test("a PROPOSED decision cannot be completed directly - must be ACCEPTED first", async () => {
  const decision = await createTestDecision();

  const blocked = await updateDecisionStatus(
    ORG_ID,
    decision.id,
    "COMPLETED",
    "skipping acceptance"
  );
  assert.equal(blocked, false);

  const final = await prisma.decision.findUniqueOrThrow({
    where: { id: decision.id },
  });
  assert.equal(final.status, "PROPOSED");
});

test("a COMPLETED decision is terminal: it cannot be re-accepted", async () => {
  const decision = await createTestDecision();
  await updateDecisionStatus(ORG_ID, decision.id, "ACCEPTED");
  await updateDecisionStatus(ORG_ID, decision.id, "COMPLETED", "done once");

  const blocked = await updateDecisionStatus(ORG_ID, decision.id, "ACCEPTED");
  assert.equal(blocked, false);

  const final = await prisma.decision.findUniqueOrThrow({
    where: { id: decision.id },
  });
  assert.equal(final.status, "COMPLETED");
});

test("IGNORED can still be reconsidered into ACCEPTED (matches the broader DECISION_LIFECYCLE FSM's IGNORED -> ACCEPTED transition)", async () => {
  const decision = await createTestDecision();
  assert.equal(
    await updateDecisionStatus(ORG_ID, decision.id, "IGNORED"),
    true
  );
  assert.equal(
    await updateDecisionStatus(ORG_ID, decision.id, "ACCEPTED"),
    true
  );

  const final = await prisma.decision.findUniqueOrThrow({
    where: { id: decision.id },
  });
  assert.equal(final.status, "ACCEPTED");
});

test("a nonexistent decision id returns false, same as before this fix", async () => {
  const result = await updateDecisionStatus(ORG_ID, randomUUID(), "ACCEPTED");
  assert.equal(result, false);
});

test("tenant isolation: a decision from another organization can never be transitioned", async () => {
  const otherOrgId = `decision-fsm-other-${TEST_RUN_ID}`;
  await prisma.organization.create({
    data: {
      id: otherOrgId,
      name: "Decision FSM Other Org",
      slug: `decision-fsm-other-${TEST_RUN_ID}`,
    },
  });

  const decision = await prisma.decision.create({
    data: {
      organizationId: otherOrgId,
      canvas: testCanvas() as never,
      priorityScore: 5,
    },
  });

  const blocked = await updateDecisionStatus(ORG_ID, decision.id, "ACCEPTED");
  assert.equal(blocked, false);

  await prisma.organization.delete({ where: { id: otherOrgId } });
});
