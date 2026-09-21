/**
 * Real Postgres integration coverage for the P1 "Radar -> PreparedAction"
 * sprint: PreparedAction.sourceOpportunityId existed in the schema (even
 * eagerly `include`d by getOpportunity()) but no application code ever set
 * it - Radar's recommendedAction was a display-only string, never turned
 * into an actionable, human-approvable PreparedAction.
 *
 * This suite exercises the real bridge
 * (opportunity-action.service.ts::prepareActionFromOpportunity), which
 * reuses the existing Brain PreparedAction lifecycle
 * (createPreparedAction/updateActionStatus/recordActionExecution)
 * unchanged rather than building a second action system.
 *
 * Same safety rules as every other suite in this directory: requires
 * INTEGRATION_DATABASE_URL explicitly, refuses anything supabase.co-shaped,
 * excluded from default `npm test`, run via `npm run test:integration`.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import type { createWatchedEntity as CreateWatchedEntityType } from "../../src/features/radar/entities/entity.service";
import type {
  recordActionExecution as RecordActionExecutionType,
  updateActionStatus as UpdateActionStatusType,
} from "../../src/features/brain/actions/action.service";
import type { prepareActionFromOpportunity as PrepareActionFromOpportunityType } from "../../src/features/radar/opportunities/opportunity-action.service";
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
const ORG_A_ID = `radar-action-org-a-${TEST_RUN_ID}`;
const ORG_B_ID = `radar-action-org-b-${TEST_RUN_ID}`;
const USER_ID = `radar-action-user-${TEST_RUN_ID}`;

let prisma: typeof PrismaType;
let createWatchedEntity: typeof CreateWatchedEntityType;
let prepareActionFromOpportunity: typeof PrepareActionFromOpportunityType;
let updateActionStatus: typeof UpdateActionStatusType;
let recordActionExecution: typeof RecordActionExecutionType;

before(async () => {
  process.env.DATABASE_URL = INTEGRATION_DATABASE_URL;
  process.env.DIRECT_URL =
    process.env.INTEGRATION_DIRECT_URL ?? INTEGRATION_DATABASE_URL;

  execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });

  const prismaModule = await import("../../src/lib/prisma");
  prisma = prismaModule.prisma;

  const entityModule =
    await import("../../src/features/radar/entities/entity.service");
  createWatchedEntity = entityModule.createWatchedEntity;

  const opportunityActionModule =
    await import("../../src/features/radar/opportunities/opportunity-action.service");
  prepareActionFromOpportunity =
    opportunityActionModule.prepareActionFromOpportunity;

  const actionModule =
    await import("../../src/features/brain/actions/action.service");
  updateActionStatus = actionModule.updateActionStatus;
  recordActionExecution = actionModule.recordActionExecution;

  await prisma.organization.createMany({
    data: [
      {
        id: ORG_A_ID,
        name: "Radar Action Org A",
        slug: `radar-action-a-${TEST_RUN_ID}`,
      },
      {
        id: ORG_B_ID,
        name: "Radar Action Org B",
        slug: `radar-action-b-${TEST_RUN_ID}`,
      },
    ],
  });
});

after(async () => {
  await prisma.organization.deleteMany({
    where: { id: { in: [ORG_A_ID, ORG_B_ID] } },
  });
  await prisma.$disconnect();
});

async function createTestOpportunity(
  organizationId: string,
  overrides: { recommendedAction?: string } = {}
) {
  const entity = await createWatchedEntity(organizationId, USER_ID, {
    name: `Radar Action Chain Co ${randomUUID().slice(0, 6)}`,
    watchReason: "PROSPECT",
    priority: 5,
    tags: [],
    notes: "",
    metadata: {},
  });

  const event = await prisma.externalEvent.create({
    data: {
      organizationId,
      externalEntityId: entity.id,
      type: "NEW_FACILITY",
      title: "Test event",
      description: "Test event for radar-prepared-action coverage.",
      occurredAt: new Date(),
      confidence: 0.8,
      evidence: [],
      source: "test",
    },
  });

  return prisma.opportunity.create({
    data: {
      organizationId,
      externalEntityId: entity.id,
      eventId: event.id,
      polarity: "OPPORTUNITY",
      title: `Test opportunity ${randomUUID().slice(0, 6)}`,
      description: "test",
      probability: 0.5,
      confidence: 0.75,
      strategicFit: 0.6,
      timeHorizon: "3-6 months",
      reasoning: "test",
      recommendedAction:
        overrides.recommendedAction ??
        "Reach out to their VP of Engineering about the new facility.",
      score: 0.6,
      scoreBreakdown: {
        relevance: 0.6,
        strategicFit: 0.6,
        economicPotential: 0.6,
        timing: 0.6,
        confidence: 0.6,
      },
    },
  });
}

test("3A/3C: prepareActionFromOpportunity creates a PreparedAction with sourceOpportunityId correctly recorded, confidence copied from the Opportunity", async () => {
  const opportunity = await createTestOpportunity(ORG_A_ID);

  const result = await prepareActionFromOpportunity(ORG_A_ID, opportunity.id);
  assert.equal(result.outcome, "created");
  assert.ok("actionId" in result);

  const action = await prisma.preparedAction.findUniqueOrThrow({
    where: { id: (result as { actionId: string }).actionId },
  });
  assert.equal(action.organizationId, ORG_A_ID);
  assert.equal(action.sourceOpportunityId, opportunity.id);
  assert.equal(action.sourceInsightId, null);
  assert.equal(action.status, "PENDING");
  assert.equal(action.type, "TASK");
  assert.equal(action.confidence, opportunity.confidence);
  assert.equal(action.description, opportunity.recommendedAction);

  // The Opportunity -> PreparedAction relation is readable in both
  // directions at the service/API level (not just a raw FK column).
  const reloadedOpportunity = await prisma.opportunity.findUniqueOrThrow({
    where: { id: opportunity.id },
    include: { preparedActions: true },
  });
  assert.equal(reloadedOpportunity.preparedActions.length, 1);
  assert.equal(
    reloadedOpportunity.preparedActions[0]?.id,
    (result as { actionId: string }).actionId
  );
});

test("3C: calling prepareActionFromOpportunity again for the same Opportunity does not create a duplicate PENDING action", async () => {
  const opportunity = await createTestOpportunity(ORG_A_ID);

  const first = await prepareActionFromOpportunity(ORG_A_ID, opportunity.id);
  assert.equal(first.outcome, "created");

  const second = await prepareActionFromOpportunity(ORG_A_ID, opportunity.id);
  assert.equal(second.outcome, "already_exists");
  assert.equal(
    (second as { actionId: string }).actionId,
    (first as { actionId: string }).actionId
  );

  const count = await prisma.preparedAction.count({
    where: { organizationId: ORG_A_ID, sourceOpportunityId: opportunity.id },
  });
  assert.equal(count, 1);
});

test("3C: a DISMISSED prior action does not block preparing a new one - dedup only guards against PENDING/APPROVED duplicates", async () => {
  const opportunity = await createTestOpportunity(ORG_A_ID);

  const first = await prepareActionFromOpportunity(ORG_A_ID, opportunity.id);
  assert.equal(first.outcome, "created");

  const dismissed = await updateActionStatus(
    ORG_A_ID,
    (first as { actionId: string }).actionId,
    "DISMISSED",
    USER_ID
  );
  assert.equal(dismissed.count, 1);

  const second = await prepareActionFromOpportunity(ORG_A_ID, opportunity.id);
  assert.equal(second.outcome, "created");
  assert.notEqual(
    (second as { actionId: string }).actionId,
    (first as { actionId: string }).actionId
  );
});

test("an Opportunity with no recommendedAction cannot have an action prepared from it", async () => {
  const opportunity = await createTestOpportunity(ORG_A_ID, {
    recommendedAction: "",
  });

  const result = await prepareActionFromOpportunity(ORG_A_ID, opportunity.id);
  assert.equal(result.outcome, "no_recommended_action");

  const count = await prisma.preparedAction.count({
    where: { organizationId: ORG_A_ID, sourceOpportunityId: opportunity.id },
  });
  assert.equal(count, 0);
});

test("tenant isolation: an Opportunity belonging to another organization cannot have an action prepared against it, and returns not_found rather than leaking existence", async () => {
  const opportunity = await createTestOpportunity(ORG_A_ID);

  const result = await prepareActionFromOpportunity(ORG_B_ID, opportunity.id);
  assert.equal(result.outcome, "not_found");

  const count = await prisma.preparedAction.count({
    where: { sourceOpportunityId: opportunity.id },
  });
  assert.equal(count, 0);
});

test("a nonexistent Opportunity id returns not_found", async () => {
  const result = await prepareActionFromOpportunity(
    ORG_A_ID,
    "nonexistent-opportunity-id"
  );
  assert.equal(result.outcome, "not_found");
});

test("3B: the existing approval lifecycle (PENDING -> APPROVED) works unchanged for a Radar-sourced action - idempotency guard included", async () => {
  const opportunity = await createTestOpportunity(ORG_A_ID);
  const result = await prepareActionFromOpportunity(ORG_A_ID, opportunity.id);
  const actionId = (result as { actionId: string }).actionId;

  const approved = await updateActionStatus(
    ORG_A_ID,
    actionId,
    "APPROVED",
    USER_ID
  );
  assert.equal(approved.count, 1);

  // Idempotency guard (pre-existing, reused unchanged): a second APPROVED
  // call on an already-APPROVED action affects zero rows.
  const secondApprove = await updateActionStatus(
    ORG_A_ID,
    actionId,
    "APPROVED",
    USER_ID
  );
  assert.equal(secondApprove.count, 0);

  const action = await prisma.preparedAction.findUniqueOrThrow({
    where: { id: actionId },
  });
  assert.equal(action.status, "APPROVED");
});

test("3B: execution idempotency (pre-existing, reused unchanged) also protects a Radar-sourced action - only an APPROVED action can be executed, and a second execution record is never created", async () => {
  const opportunity = await createTestOpportunity(ORG_A_ID);
  const result = await prepareActionFromOpportunity(ORG_A_ID, opportunity.id);
  const actionId = (result as { actionId: string }).actionId;

  // Still PENDING - executing it must be rejected (never skip approval).
  const rejected = await recordActionExecution({
    organizationId: ORG_A_ID,
    preparedActionId: actionId,
    channel: "CLIPBOARD",
    status: "COMPLETED",
    actorUserId: USER_ID,
  });
  assert.equal(rejected, null);

  await updateActionStatus(ORG_A_ID, actionId, "APPROVED", USER_ID);

  const firstExecution = await recordActionExecution({
    organizationId: ORG_A_ID,
    preparedActionId: actionId,
    channel: "CLIPBOARD",
    status: "COMPLETED",
    actorUserId: USER_ID,
  });
  assert.ok(firstExecution);

  const secondExecution = await recordActionExecution({
    organizationId: ORG_A_ID,
    preparedActionId: actionId,
    channel: "CLIPBOARD",
    status: "COMPLETED",
    actorUserId: USER_ID,
  });
  assert.equal(secondExecution?.id, firstExecution?.id);

  const executionCount = await prisma.actionExecution.count({
    where: { preparedActionId: actionId },
  });
  assert.equal(executionCount, 1);
});
