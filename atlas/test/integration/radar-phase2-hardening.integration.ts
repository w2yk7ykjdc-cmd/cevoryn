/**
 * Real Postgres integration coverage for the Phase 2 production-hardening
 * additions that test/integration/radar-pipeline.integration.ts predates:
 * action-execution approval guard + idempotency, notification-read
 * authorization scoping, the AuditLog trail, PipelineRun observability,
 * and the WorkerTask/Worker abstraction. Each of these is a real DB-backed
 * service, so - same as the sibling suite - this exercises the actual
 * exported functions against a real database rather than mocking Prisma.
 *
 * Same safety rules as the other integration suites: requires
 * INTEGRATION_DATABASE_URL explicitly, refuses anything supabase.co-shaped,
 * excluded from default `npm test`, run via `npm run test:integration`.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import type {
  recordActionExecution as RecordActionExecutionType,
  updateActionStatus as UpdateActionStatusType,
} from "../../src/features/brain/actions/action.service";
import type {
  listAuditLogs as ListAuditLogsType,
  recordAuditEvent as RecordAuditEventType,
} from "../../src/features/enterprise/audit/audit.service";
import type { createWatchedEntity as CreateWatchedEntityType } from "../../src/features/radar/entities/entity.service";
import type {
  createNotification as CreateNotificationType,
  markNotificationRead as MarkNotificationReadType,
} from "../../src/features/radar/notifications/notification.service";
import type { listPipelineRuns as ListPipelineRunsType } from "../../src/features/radar/pipeline-run.service";
import type { createResearchTask as CreateResearchTaskType } from "../../src/features/radar/workers/research-worker";
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
const ORG_ID = `phase2-test-org-${TEST_RUN_ID}`;
const USER_ID = `phase2-test-user-${TEST_RUN_ID}`;
const OTHER_USER_ID = `phase2-test-other-user-${TEST_RUN_ID}`;

let prisma: typeof PrismaType;
let createWatchedEntity: typeof CreateWatchedEntityType;
let updateActionStatus: typeof UpdateActionStatusType;
let recordActionExecution: typeof RecordActionExecutionType;
let createNotification: typeof CreateNotificationType;
let markNotificationRead: typeof MarkNotificationReadType;
let recordAuditEvent: typeof RecordAuditEventType;
let listAuditLogs: typeof ListAuditLogsType;
let listPipelineRuns: typeof ListPipelineRunsType;
let createResearchTask: typeof CreateResearchTaskType;

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

  const actionModule =
    await import("../../src/features/brain/actions/action.service");
  updateActionStatus = actionModule.updateActionStatus;
  recordActionExecution = actionModule.recordActionExecution;

  const notificationModule =
    await import("../../src/features/radar/notifications/notification.service");
  createNotification = notificationModule.createNotification;
  markNotificationRead = notificationModule.markNotificationRead;

  const auditModule =
    await import("../../src/features/enterprise/audit/audit.service");
  recordAuditEvent = auditModule.recordAuditEvent;
  listAuditLogs = auditModule.listAuditLogs;

  const pipelineRunModule =
    await import("../../src/features/radar/pipeline-run.service");
  listPipelineRuns = pipelineRunModule.listPipelineRuns;

  const workerModule =
    await import("../../src/features/radar/workers/research-worker");
  createResearchTask = workerModule.createResearchTask;

  await prisma.organization.create({
    data: {
      id: ORG_ID,
      name: "Phase 2 Test Org",
      slug: `phase2-test-${TEST_RUN_ID}`,
    },
  });
});

after(async () => {
  await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  await prisma.$disconnect();
});

async function createTestOpportunityChain() {
  const entity = await createWatchedEntity(ORG_ID, USER_ID, {
    name: `Phase2 Chain Co ${randomUUID().slice(0, 6)}`,
    watchReason: "PROSPECT",
    priority: 5,
    tags: [],
    notes: "",
    metadata: {},
  });

  const event = await prisma.externalEvent.create({
    data: {
      organizationId: ORG_ID,
      externalEntityId: entity.id,
      type: "NEW_FACILITY",
      title: "Test event",
      description: "Test event for Phase 2 integration coverage.",
      occurredAt: new Date(),
      confidence: 0.8,
      evidence: [],
      source: "test",
    },
  });

  const opportunity = await prisma.opportunity.create({
    data: {
      organizationId: ORG_ID,
      externalEntityId: entity.id,
      eventId: event.id,
      polarity: "OPPORTUNITY",
      title: "Phase 2 test opportunity",
      description: "Test description",
      probability: 0.5,
      confidence: 0.8,
      strategicFit: 0.6,
      timeHorizon: "1-3 months",
      reasoning: "Test reasoning",
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

  return { entity, event, opportunity };
}

test("recordActionExecution refuses to record an execution for a PENDING (never approved) action", async () => {
  const { opportunity } = await createTestOpportunityChain();
  const action = await prisma.preparedAction.create({
    data: {
      organizationId: ORG_ID,
      type: "TASK",
      title: "Unapproved action",
      description: "Should not be executable",
      content: {},
      sourceOpportunityId: opportunity.id,
      confidence: 0.5,
      reasoning: "test",
    },
  });

  const execution = await recordActionExecution({
    organizationId: ORG_ID,
    preparedActionId: action.id,
    channel: "MAILTO",
    status: "COMPLETED",
    actorUserId: USER_ID,
  });

  assert.equal(execution, null);
  const count = await prisma.actionExecution.count({
    where: { preparedActionId: action.id },
  });
  assert.equal(count, 0);
});

test("recordActionExecution refuses to record an execution for a DISMISSED action", async () => {
  const { opportunity } = await createTestOpportunityChain();
  const action = await prisma.preparedAction.create({
    data: {
      organizationId: ORG_ID,
      type: "TASK",
      title: "Dismissed action",
      description: "Should not be executable",
      content: {},
      sourceOpportunityId: opportunity.id,
      confidence: 0.5,
      reasoning: "test",
    },
  });

  await updateActionStatus(ORG_ID, action.id, "DISMISSED", USER_ID);

  const execution = await recordActionExecution({
    organizationId: ORG_ID,
    preparedActionId: action.id,
    channel: "MAILTO",
    status: "COMPLETED",
    actorUserId: USER_ID,
  });

  assert.equal(execution, null);
});

test("updateActionStatus is idempotent: a second APPROVED call after the first affects zero rows", async () => {
  const { opportunity } = await createTestOpportunityChain();
  const action = await prisma.preparedAction.create({
    data: {
      organizationId: ORG_ID,
      type: "TASK",
      title: "Double-approve action",
      description: "test",
      content: {},
      sourceOpportunityId: opportunity.id,
      confidence: 0.5,
      reasoning: "test",
    },
  });

  const first = await updateActionStatus(
    ORG_ID,
    action.id,
    "APPROVED",
    USER_ID
  );
  assert.equal(first.count, 1);

  const second = await updateActionStatus(
    ORG_ID,
    action.id,
    "APPROVED",
    USER_ID
  );
  assert.equal(second.count, 0);
});

test("recordActionExecution succeeds once approved, and a duplicate call returns the same execution instead of creating a second one", async () => {
  const { opportunity } = await createTestOpportunityChain();
  const action = await prisma.preparedAction.create({
    data: {
      organizationId: ORG_ID,
      type: "TASK",
      title: "Approved action",
      description: "test",
      content: {},
      sourceOpportunityId: opportunity.id,
      confidence: 0.5,
      reasoning: "test",
    },
  });

  await updateActionStatus(ORG_ID, action.id, "APPROVED", USER_ID);

  const first = await recordActionExecution({
    organizationId: ORG_ID,
    preparedActionId: action.id,
    channel: "MAILTO",
    status: "COMPLETED",
    actorUserId: USER_ID,
  });
  assert.ok(first);

  const second = await recordActionExecution({
    organizationId: ORG_ID,
    preparedActionId: action.id,
    channel: "MAILTO",
    status: "COMPLETED",
    actorUserId: USER_ID,
  });
  assert.ok(second);
  assert.equal(second?.id, first?.id);

  const count = await prisma.actionExecution.count({
    where: { preparedActionId: action.id, status: "COMPLETED" },
  });
  assert.equal(count, 1);

  const auditEvents = await listAuditLogs(ORG_ID, {
    resourceType: "prepared_action",
    resourceId: action.id,
  });
  assert.equal(
    auditEvents.filter((e) => e.action === "action.executed").length,
    1,
    "the deduplicated retry must not write a second audit event either"
  );
});

test("markNotificationRead cannot mark another member's personal notification as read", async () => {
  const notification = await createNotification({
    organizationId: ORG_ID,
    userId: OTHER_USER_ID,
    type: "SYSTEM_ALERT",
    title: "Private to the other user",
    body: "test",
  });

  const result = await markNotificationRead(ORG_ID, USER_ID, notification.id);
  assert.equal(result.count, 0);

  const stillUnread = await prisma.notification.findUnique({
    where: { id: notification.id },
  });
  assert.equal(stillUnread?.readAt, null);
});

test("markNotificationRead lets a member mark their own notification, and any member mark an org-wide broadcast", async () => {
  const own = await createNotification({
    organizationId: ORG_ID,
    userId: USER_ID,
    type: "SYSTEM_ALERT",
    title: "Mine",
    body: "test",
  });
  const ownResult = await markNotificationRead(ORG_ID, USER_ID, own.id);
  assert.equal(ownResult.count, 1);

  const broadcast = await createNotification({
    organizationId: ORG_ID,
    type: "SYSTEM_ALERT",
    title: "Broadcast",
    body: "test",
    entityType: "test_broadcast",
    entityId: randomUUID(),
  });
  const broadcastResult = await markNotificationRead(
    ORG_ID,
    OTHER_USER_ID,
    broadcast.id
  );
  assert.equal(broadcastResult.count, 1);
});

test("recordAuditEvent writes a real row, scoped and queryable per organization", async () => {
  const resourceId = randomUUID();
  await recordAuditEvent({
    organizationId: ORG_ID,
    actorType: "USER",
    actorId: USER_ID,
    action: "entity.created",
    resourceType: "external_entity",
    resourceId,
    metadata: { name: "Audit Test Co" },
  });

  const logs = await listAuditLogs(ORG_ID, {
    resourceType: "external_entity",
    resourceId,
  });
  assert.equal(logs.length, 1);
  assert.equal(logs[0]?.action, "entity.created");
  assert.equal(logs[0]?.actorId, USER_ID);
});

test("PipelineRun rows are queryable per organization via listPipelineRuns, newest first", async () => {
  const older = await prisma.pipelineRun.create({
    data: {
      organizationId: ORG_ID,
      status: "COMPLETED",
      signalsIngested: 1,
      startedAt: new Date(Date.now() - 60_000),
      completedAt: new Date(Date.now() - 59_000),
    },
  });
  const newer = await prisma.pipelineRun.create({
    data: {
      organizationId: ORG_ID,
      status: "FAILED",
      errorCount: 1,
      errors: ["pipeline: simulated failure"],
      completedAt: new Date(),
    },
  });

  const runs = await listPipelineRuns(ORG_ID, { take: 10 });
  const ids = runs.map((r) => r.id);
  assert.ok(ids.indexOf(newer.id) < ids.indexOf(older.id));
  const failedRun = runs.find((r) => r.id === newer.id);
  assert.equal(failedRun?.status, "FAILED");
  assert.deepEqual(failedRun?.errors, ["pipeline: simulated failure"]);
});

test("createResearchTask (Worker abstraction) is tenant-scoped: it refuses to create a task for an opportunity that does not belong to the caller's organization", async () => {
  const { opportunity } = await createTestOpportunityChain();

  const otherOrgId = `phase2-test-org-other-${TEST_RUN_ID}`;
  await prisma.organization.create({
    data: {
      id: otherOrgId,
      name: "Other Org",
      slug: `phase2-other-${TEST_RUN_ID}`,
    },
  });

  try {
    const task = await createResearchTask(otherOrgId, opportunity.id, USER_ID);
    assert.equal(task, null);

    const taskCount = await prisma.workerTask.count({
      where: { opportunityId: opportunity.id },
    });
    assert.equal(taskCount, 0);
  } finally {
    await prisma.organization.deleteMany({ where: { id: otherOrgId } });
  }
});

test("createResearchTask creates a real, tenant-scoped WorkerTask row for a valid opportunity", async () => {
  const { opportunity } = await createTestOpportunityChain();

  const task = await createResearchTask(ORG_ID, opportunity.id, USER_ID);
  assert.ok(task);

  const row = await prisma.workerTask.findUnique({
    where: { id: task?.taskId },
  });
  assert.equal(row?.organizationId, ORG_ID);
  assert.equal(row?.workerType, "RESEARCH");
  assert.equal(row?.status, "PENDING");
});
