/**
 * Real Postgres integration test for the Radar feature's data layer:
 * Signal -> Event -> Opportunity -> Action -> Outcome, exercised through
 * the real exported service functions (not raw SQL assertions alone).
 * Covers three things a pure-unit test cannot: (1) idempotent signal
 * ingestion actually relies on the DB's (organizationId, hash) unique
 * constraint working, not just application logic, (2) tenant isolation is
 * enforced by the real Prisma queries, not just "we remembered to pass
 * organizationId" in a unit test's mocked call, (3) cascade-delete
 * behavior across the whole new model chain when an Organization is
 * removed.
 *
 * Same safety rules as the other integration suites: requires
 * INTEGRATION_DATABASE_URL explicitly, refuses anything supabase.co-shaped,
 * excluded from default `npm test`, run via `npm run test:integration`.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import type { createWatchedEntity as CreateWatchedEntityType } from "../../src/features/radar/entities/entity.service";
import type { updateWatchedEntity as UpdateWatchedEntityType } from "../../src/features/radar/entities/entity.service";
import type { listWatchedEntities as ListWatchedEntitiesType } from "../../src/features/radar/entities/entity.service";
import type { DuplicateEntityError as DuplicateEntityErrorType } from "../../src/features/radar/entities/entity.service";
import type { listEvents as ListEventsType } from "../../src/features/radar/events/event.service";
import type {
  countUnreadNotifications as CountUnreadNotificationsType,
  createNotification as CreateNotificationType,
  markAllNotificationsRead as MarkAllNotificationsReadType,
} from "../../src/features/radar/notifications/notification.service";
import type {
  getOpportunity as GetOpportunityType,
  listOpportunities as ListOpportunitiesType,
  updateOpportunityStatus as UpdateOpportunityStatusType,
} from "../../src/features/radar/opportunities/opportunity.service";
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
const ORG_A_ID = `radar-test-org-a-${TEST_RUN_ID}`;
const ORG_B_ID = `radar-test-org-b-${TEST_RUN_ID}`;
const USER_ID = `radar-test-user-${TEST_RUN_ID}`;

let prisma: typeof PrismaType;
let createWatchedEntity: typeof CreateWatchedEntityType;
let updateWatchedEntity: typeof UpdateWatchedEntityType;
let listWatchedEntities: typeof ListWatchedEntitiesType;
let DuplicateEntityError: typeof DuplicateEntityErrorType;
let listEvents: typeof ListEventsType;
let listOpportunities: typeof ListOpportunitiesType;
let getOpportunity: typeof GetOpportunityType;
let updateOpportunityStatus: typeof UpdateOpportunityStatusType;
let createNotification: typeof CreateNotificationType;
let countUnreadNotifications: typeof CountUnreadNotificationsType;
let markAllNotificationsRead: typeof MarkAllNotificationsReadType;

before(async () => {
  process.env.DATABASE_URL = INTEGRATION_DATABASE_URL;
  process.env.DIRECT_URL =
    process.env.INTEGRATION_DIRECT_URL ?? INTEGRATION_DATABASE_URL;

  execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });

  const prismaModule = await import("../../src/lib/prisma");
  prisma = prismaModule.prisma;

  const entityModule = await import("../../src/features/radar/entities/entity.service");
  createWatchedEntity = entityModule.createWatchedEntity;
  updateWatchedEntity = entityModule.updateWatchedEntity;
  listWatchedEntities = entityModule.listWatchedEntities;
  DuplicateEntityError = entityModule.DuplicateEntityError;

  const eventModule = await import("../../src/features/radar/events/event.service");
  listEvents = eventModule.listEvents;

  const opportunityModule =
    await import("../../src/features/radar/opportunities/opportunity.service");
  listOpportunities = opportunityModule.listOpportunities;
  getOpportunity = opportunityModule.getOpportunity;
  updateOpportunityStatus = opportunityModule.updateOpportunityStatus;

  const notificationModule =
    await import("../../src/features/radar/notifications/notification.service");
  createNotification = notificationModule.createNotification;
  countUnreadNotifications = notificationModule.countUnreadNotifications;
  markAllNotificationsRead = notificationModule.markAllNotificationsRead;

  await prisma.organization.createMany({
    data: [
      { id: ORG_A_ID, name: "Radar Test Org A", slug: `radar-test-a-${TEST_RUN_ID}` },
      { id: ORG_B_ID, name: "Radar Test Org B", slug: `radar-test-b-${TEST_RUN_ID}` },
    ],
  });
});

after(async () => {
  // Cascade-delete: removing the two Organizations should take every
  // Radar row created under them with it.
  await prisma.organization.deleteMany({
    where: { id: { in: [ORG_A_ID, ORG_B_ID] } },
  });
  await prisma.$disconnect();
});

test("createWatchedEntity rejects a duplicate normalized name within the same org", async () => {
  await createWatchedEntity(ORG_A_ID, USER_ID, {
    name: "Duplicate Co",
    watchReason: "PROSPECT",
    priority: 5,
    tags: [],
    notes: "",
    metadata: {},
  });

  await assert.rejects(
    () =>
      createWatchedEntity(ORG_A_ID, USER_ID, {
        name: "Duplicate Co, Inc.",
        watchReason: "CUSTOMER",
        priority: 5,
    tags: [],
    notes: "",
    metadata: {},
      }),
    DuplicateEntityError
  );
});

test("the same company name is allowed in two different organizations (no cross-tenant entity resolution)", async () => {
  const entityA = await createWatchedEntity(ORG_A_ID, USER_ID, {
    name: "Shared Name Co",
    watchReason: "PROSPECT",
    priority: 5,
    tags: [],
    notes: "",
    metadata: {},
  });
  const entityB = await createWatchedEntity(ORG_B_ID, USER_ID, {
    name: "Shared Name Co",
    watchReason: "COMPETITOR",
    priority: 5,
    tags: [],
    notes: "",
    metadata: {},
  });

  assert.notEqual(entityA.id, entityB.id);
  assert.equal(entityA.organizationId, ORG_A_ID);
  assert.equal(entityB.organizationId, ORG_B_ID);
});

test("tenant isolation: org A cannot list, update, or see org B's watchlist entities", async () => {
  const entityB = await createWatchedEntity(ORG_B_ID, USER_ID, {
    name: "Org B Only Co",
    watchReason: "SUPPLIER",
    priority: 5,
    tags: [],
    notes: "",
    metadata: {},
  });

  const orgAEntities = await listWatchedEntities(ORG_A_ID);
  assert.equal(
    orgAEntities.some((e) => e.id === entityB.id),
    false,
    "org A's list must never contain org B's entity"
  );

  const updateResult = await updateWatchedEntity(
    ORG_A_ID,
    entityB.id,
    { isActive: false },
    USER_ID
  );
  assert.equal(
    updateResult.count,
    0,
    "updateMany scoped to org A must affect zero rows for org B's entity id"
  );

  const stillActive = await prisma.externalEntity.findUnique({
    where: { id: entityB.id },
    select: { isActive: true },
  });
  assert.equal(
    stillActive?.isActive,
    true,
    "org B's entity must be untouched by org A's update attempt"
  );
});

test("idempotent signal ingestion: the (organizationId, hash) unique constraint silently skips a re-ingested duplicate", async () => {
  const entity = await createWatchedEntity(ORG_A_ID, USER_ID, {
    name: "Ingestion Test Co",
    watchReason: "PROSPECT",
    priority: 5,
    tags: [],
    notes: "",
    metadata: {},
  });

  const hash = randomUUID();
  const signalData = {
    organizationId: ORG_A_ID,
    externalEntityId: entity.id,
    source: "rss",
    sourceType: "PRESS_RELEASE" as const,
    sourceUrl: "https://example.com/post",
    title: "Test press release",
    rawContent: "Some content",
    hash,
  };

  const firstRun = await prisma.externalSignal.createMany({
    data: [signalData],
    skipDuplicates: true,
  });
  assert.equal(firstRun.count, 1);

  // Simulate a re-ingestion of the exact same item (same hash).
  const secondRun = await prisma.externalSignal.createMany({
    data: [signalData],
    skipDuplicates: true,
  });
  assert.equal(secondRun.count, 0, "a duplicate hash must not create a second row");

  const total = await prisma.externalSignal.count({
    where: { organizationId: ORG_A_ID, hash },
  });
  assert.equal(total, 1);
});

test("the same signal hash is independent per organization (no cross-tenant dedup)", async () => {
  const entityA = await createWatchedEntity(ORG_A_ID, USER_ID, {
    name: "Cross Tenant Hash Co A",
    watchReason: "PROSPECT",
    priority: 5,
    tags: [],
    notes: "",
    metadata: {},
  });
  const entityB = await createWatchedEntity(ORG_B_ID, USER_ID, {
    name: "Cross Tenant Hash Co B",
    watchReason: "PROSPECT",
    priority: 5,
    tags: [],
    notes: "",
    metadata: {},
  });

  const sharedHash = randomUUID();
  await prisma.externalSignal.createMany({
    data: [
      {
        organizationId: ORG_A_ID,
        externalEntityId: entityA.id,
        source: "rss",
        sourceType: "PRESS_RELEASE",
        sourceUrl: "https://example.com/shared",
        title: "Shared",
        rawContent: "content",
        hash: sharedHash,
      },
      {
        organizationId: ORG_B_ID,
        externalEntityId: entityB.id,
        source: "rss",
        sourceType: "PRESS_RELEASE",
        sourceUrl: "https://example.com/shared",
        title: "Shared",
        rawContent: "content",
        hash: sharedHash,
      },
    ],
    skipDuplicates: true,
  });

  const countA = await prisma.externalSignal.count({
    where: { organizationId: ORG_A_ID, hash: sharedHash },
  });
  const countB = await prisma.externalSignal.count({
    where: { organizationId: ORG_B_ID, hash: sharedHash },
  });
  assert.equal(countA, 1);
  assert.equal(countB, 1);
});

test("full chain: Signal -> Event -> Opportunity -> Action -> Outcome links resolve correctly and stay tenant-scoped", async () => {
  const entity = await createWatchedEntity(ORG_A_ID, USER_ID, {
    name: "Full Chain Co",
    watchReason: "PROSPECT",
    priority: 5,
    tags: [],
    notes: "",
    metadata: {},
  });

  const signal = await prisma.externalSignal.create({
    data: {
      organizationId: ORG_A_ID,
      externalEntityId: entity.id,
      source: "rss",
      sourceType: "PRESS_RELEASE",
      sourceUrl: "https://example.com/chain",
      title: "Full Chain Co opens new facility",
      rawContent: "Full Chain Co announced a new facility.",
      hash: randomUUID(),
    },
  });

  const event = await prisma.externalEvent.create({
    data: {
      organizationId: ORG_A_ID,
      externalEntityId: entity.id,
      type: "NEW_FACILITY",
      title: "New facility opened",
      description: "Test event for integration coverage.",
      occurredAt: new Date(),
      confidence: 0.8,
      evidence: [{ label: signal.title, sourceUrl: signal.sourceUrl }],
      source: "test",
    },
  });

  const opportunity = await prisma.opportunity.create({
    data: {
      organizationId: ORG_A_ID,
      externalEntityId: entity.id,
      eventId: event.id,
      polarity: "OPPORTUNITY",
      title: "Test opportunity",
      description: "Test description",
      estimatedValueMin: 10_000,
      estimatedValueMax: 50_000,
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

  const preparedAction = await prisma.preparedAction.create({
    data: {
      organizationId: ORG_A_ID,
      type: "TASK",
      title: "Research this opportunity",
      description: "Follow up",
      content: {},
      sourceOpportunityId: opportunity.id,
      confidence: 0.7,
      reasoning: "Generated from an opportunity",
    },
  });

  const outcome = await prisma.outcomeEvaluation.create({
    data: {
      organizationId: ORG_A_ID,
      opportunityId: opportunity.id,
      result: "SUCCESS",
      outcomeScore: 0.9,
      explanation: "Converted to a real deal.",
    },
  });

  // Fetched via the real service function, not a raw query - exercises
  // the actual include/relation wiring the API routes depend on.
  const fetched = await getOpportunity(ORG_A_ID, opportunity.id);
  assert.ok(fetched);
  assert.equal(fetched?.event.id, event.id);
  assert.equal(fetched?.externalEntity.id, entity.id);
  assert.equal(fetched?.preparedActions.some((a) => a.id === preparedAction.id), true);

  assert.equal(outcome.decisionId, null, "a Radar-sourced outcome has no Decision link");
  assert.equal(outcome.opportunityId, opportunity.id);

  const events = await listEvents(ORG_A_ID, { take: 50 });
  assert.equal(events.some((e) => e.id === event.id), true);

  const opportunities = await listOpportunities(ORG_A_ID, { take: 50 });
  assert.equal(opportunities.some((o) => o.id === opportunity.id), true);

  // Tenant isolation on the same fetch path, for good measure.
  const fetchedFromWrongOrg = await getOpportunity(ORG_B_ID, opportunity.id);
  assert.equal(fetchedFromWrongOrg, null);

  const statusUpdate = await updateOpportunityStatus(
    ORG_A_ID,
    opportunity.id,
    "WON",
    USER_ID
  );
  assert.equal(statusUpdate.count, 1);
  const wrongOrgStatusUpdate = await updateOpportunityStatus(
    ORG_B_ID,
    opportunity.id,
    "LOST",
    USER_ID
  );
  assert.equal(
    wrongOrgStatusUpdate.count,
    0,
    "org B must not be able to update org A's opportunity"
  );
});

test("cascade delete: removing an Organization removes its entities, signals, events, and opportunities", async () => {
  const orgId = `radar-cascade-test-${randomUUID().slice(0, 8)}`;
  await prisma.organization.create({
    data: { id: orgId, name: "Cascade Test Org", slug: orgId },
  });

  const entity = await createWatchedEntity(orgId, USER_ID, {
    name: "Cascade Co",
    watchReason: "PROSPECT",
    priority: 5,
    tags: [],
    notes: "",
    metadata: {},
  });
  const signal = await prisma.externalSignal.create({
    data: {
      organizationId: orgId,
      externalEntityId: entity.id,
      source: "rss",
      sourceType: "PRESS_RELEASE",
      sourceUrl: "https://example.com/cascade",
      title: "Cascade signal",
      rawContent: "content",
      hash: randomUUID(),
    },
  });
  const event = await prisma.externalEvent.create({
    data: {
      organizationId: orgId,
      externalEntityId: entity.id,
      type: "EXPANSION",
      title: "Cascade event",
      description: "d",
      occurredAt: new Date(),
      confidence: 0.5,
      source: "test",
    },
  });
  const opportunity = await prisma.opportunity.create({
    data: {
      organizationId: orgId,
      externalEntityId: entity.id,
      eventId: event.id,
      title: "Cascade opportunity",
      description: "d",
      probability: 0.5,
      confidence: 0.5,
      strategicFit: 0.5,
      timeHorizon: "n/a",
      reasoning: "r",
      score: 0.5,
      scoreBreakdown: {},
    },
  });

  await prisma.organization.delete({ where: { id: orgId } });

  assert.equal(await prisma.externalEntity.findUnique({ where: { id: entity.id } }), null);
  assert.equal(await prisma.externalSignal.findUnique({ where: { id: signal.id } }), null);
  assert.equal(await prisma.externalEvent.findUnique({ where: { id: event.id } }), null);
  assert.equal(await prisma.opportunity.findUnique({ where: { id: opportunity.id } }), null);
});

test("notifications: org-scoped broadcast and per-user unread counting/mark-all-read", async () => {
  await createNotification({
    organizationId: ORG_A_ID,
    type: "SYSTEM_ALERT",
    title: "Broadcast alert",
    body: "Visible to every member",
  });
  await createNotification({
    organizationId: ORG_A_ID,
    userId: USER_ID,
    type: "NEW_OPPORTUNITY",
    title: "Personal notification",
    body: "Only for this user",
  });
  await createNotification({
    organizationId: ORG_B_ID,
    type: "SYSTEM_ALERT",
    title: "Org B alert",
    body: "Must not leak into org A's count",
  });

  const unreadCount = await countUnreadNotifications(ORG_A_ID, USER_ID);
  assert.ok(
    unreadCount >= 2,
    "the broadcast and the personal notification must both count as unread for this user"
  );

  const markResult = await markAllNotificationsRead(ORG_A_ID, USER_ID);
  assert.ok(markResult.count >= 2);

  const unreadAfter = await countUnreadNotifications(ORG_A_ID, USER_ID);
  assert.equal(unreadAfter, 0);
});
