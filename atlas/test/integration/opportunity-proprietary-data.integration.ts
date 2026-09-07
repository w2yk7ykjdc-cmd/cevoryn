/**
 * Real Postgres integration coverage for Step 6: wiring Proprietary Data
 * into Opportunity/Threat generation. Exercises the actual exported
 * functions against a real database - no Prisma mocking.
 *
 * What this suite CAN verify without a real AI provider credential: the
 * entire deterministic side of the wiring - the billing-gated proprietary
 * fetch (getProprietaryDataForOpportunityGeneration), tenant isolation,
 * the max-record cap, and that a non-RADAR organization's proprietary data
 * is never read even when it exists. Pure evidence-tagging/truncation
 * logic (asExternalEvidence/buildProprietaryEvidence/mergeOpportunityEvidence/
 * excerptProprietaryContent) is covered by fast unit tests instead (no DB
 * needed for those - see test/radar-opportunity-generation-math.test.ts
 * and test/proprietary-data-content-excerpt.test.ts).
 *
 * What this suite CANNOT verify in this environment: the actual LLM-
 * generated reasoning/recommendedAction content with proprietary context
 * present, and the full generateOpportunityForEvent() -> Opportunity row
 * with merged evidence end-to-end - both require a real AI provider
 * credential this environment does not have. That is reported as BLOCKED,
 * not faked with a mocked completion.
 *
 * Same safety rules as the other integration suites: requires
 * INTEGRATION_DATABASE_URL explicitly, refuses anything supabase.co-shaped,
 * excluded from default `npm test`, run via `npm run test:integration`.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import type { createProprietaryDataRecord as CreateProprietaryDataRecordType } from "../../src/features/enterprise/proprietary-data/proprietary-data.service";
import type { getProprietaryDataForOpportunityGeneration as GetProprietaryDataForOpportunityGenerationType } from "../../src/features/enterprise/proprietary-data/proprietary-data.service";
import type { prisma as PrismaType } from "../../src/lib/prisma";
import type { createWatchedEntity as CreateWatchedEntityType } from "../../src/features/radar/entities/entity.service";
import type { generateOpportunityForEvent as GenerateOpportunityForEventType } from "../../src/features/radar/opportunities/opportunity-generator";

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
const RADAR_ORG_ID = `oppdata-radar-org-${TEST_RUN_ID}`;
const STARTER_ORG_ID = `oppdata-starter-org-${TEST_RUN_ID}`;
const USER_ID = `oppdata-test-user-${TEST_RUN_ID}`;

let prisma: typeof PrismaType;
let createProprietaryDataRecord: typeof CreateProprietaryDataRecordType;
let getProprietaryDataForOpportunityGeneration: typeof GetProprietaryDataForOpportunityGenerationType;
let createWatchedEntity: typeof CreateWatchedEntityType;
let generateOpportunityForEvent: typeof GenerateOpportunityForEventType;

before(async () => {
  process.env.DATABASE_URL = INTEGRATION_DATABASE_URL;
  process.env.DIRECT_URL =
    process.env.INTEGRATION_DIRECT_URL ?? INTEGRATION_DATABASE_URL;

  execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });

  const prismaModule = await import("../../src/lib/prisma");
  prisma = prismaModule.prisma;

  const serviceModule =
    await import("../../src/features/enterprise/proprietary-data/proprietary-data.service");
  createProprietaryDataRecord = serviceModule.createProprietaryDataRecord;
  getProprietaryDataForOpportunityGeneration =
    serviceModule.getProprietaryDataForOpportunityGeneration;

  const entityModule =
    await import("../../src/features/radar/entities/entity.service");
  createWatchedEntity = entityModule.createWatchedEntity;

  const generatorModule =
    await import("../../src/features/radar/opportunities/opportunity-generator");
  generateOpportunityForEvent = generatorModule.generateOpportunityForEvent;

  await prisma.organization.createMany({
    data: [
      {
        id: RADAR_ORG_ID,
        name: "Opportunity Proprietary Data RADAR Org",
        slug: `oppdata-radar-${TEST_RUN_ID}`,
      },
      {
        id: STARTER_ORG_ID,
        name: "Opportunity Proprietary Data STARTER Org",
        slug: `oppdata-starter-${TEST_RUN_ID}`,
      },
    ],
  });

  // Give RADAR_ORG_ID a real, active Professional-plan subscription so
  // getOrganizationPlan() resolves it to PROFESSIONAL (hasFeature(...,
  // "RADAR") === true). STARTER_ORG_ID deliberately gets no subscription
  // row at all - getOrganizationEntitlements() already defaults an
  // organization with no active subscription to STARTER, so that's the
  // real, unmodified default behavior, not a special-cased test path.
  await prisma.subscription.create({
    data: {
      organizationId: RADAR_ORG_ID,
      stripeCustomerId: `stripe-cus-${TEST_RUN_ID}`,
      plan: "PROFESSIONAL",
      subscriptionStatus: "ACTIVE",
    },
  });
});

after(async () => {
  await prisma.organization.deleteMany({
    where: { id: { in: [RADAR_ORG_ID, STARTER_ORG_ID] } },
  });
  await prisma.$disconnect();
});

test("a RADAR-plan organization's proprietary data is fetched for opportunity generation", async () => {
  await createProprietaryDataRecord(RADAR_ORG_ID, USER_ID, {
    sourceKind: "KNOWLEDGE_BASE",
    title: "Enterprise pricing tiers",
    content: "Our enterprise tier starts at $50k/year.",
    tags: [],
  });

  const records =
    await getProprietaryDataForOpportunityGeneration(RADAR_ORG_ID);
  assert.equal(records.length, 1);
  assert.equal(records[0]?.title, "Enterprise pricing tiers");
});

test("a STARTER-plan organization's proprietary data is NEVER read, even though it exists", async () => {
  await createProprietaryDataRecord(STARTER_ORG_ID, USER_ID, {
    sourceKind: "KNOWLEDGE_BASE",
    title: "Should never be read for generation",
    content: "This organization is not on a RADAR-entitled plan.",
    tags: [],
  });

  const records =
    await getProprietaryDataForOpportunityGeneration(STARTER_ORG_ID);
  assert.deepEqual(records, []);

  // The record genuinely exists (this isn't "no data" - it's "not entitled
  // to read it"), confirmed independently of the gated function above.
  const rawCount = await prisma.proprietaryDataRecord.count({
    where: { organizationId: STARTER_ORG_ID },
  });
  assert.equal(rawCount, 1);
});

test("the proprietary fetch for generation is tenant-scoped: a RADAR org never sees another org's records", async () => {
  const records =
    await getProprietaryDataForOpportunityGeneration(RADAR_ORG_ID);
  assert.ok(
    records.every((r) => r.title !== "Should never be read for generation")
  );
});

test("the proprietary fetch for generation respects the max-record cap", async () => {
  const cappedOrgId = `oppdata-capped-org-${TEST_RUN_ID}`;
  await prisma.organization.create({
    data: {
      id: cappedOrgId,
      name: "Capped Org",
      slug: `oppdata-capped-${TEST_RUN_ID}`,
    },
  });
  await prisma.subscription.create({
    data: {
      organizationId: cappedOrgId,
      stripeCustomerId: `stripe-cus-capped-${TEST_RUN_ID}`,
      plan: "BUSINESS",
      subscriptionStatus: "ACTIVE",
    },
  });

  for (let i = 0; i < 8; i += 1) {
    await createProprietaryDataRecord(cappedOrgId, USER_ID, {
      sourceKind: "KNOWLEDGE_BASE",
      title: `Record ${i}`,
      content: "content",
      tags: [],
    });
  }

  const records = await getProprietaryDataForOpportunityGeneration(
    cappedOrgId,
    5
  );
  assert.equal(records.length, 5);

  await prisma.organization.delete({ where: { id: cappedOrgId } });
});

test("a downgraded organization (was RADAR, subscription now canceled) stops having its proprietary data read", async () => {
  const downgradedOrgId = `oppdata-downgraded-org-${TEST_RUN_ID}`;
  await prisma.organization.create({
    data: {
      id: downgradedOrgId,
      name: "Downgraded Org",
      slug: `oppdata-downgraded-${TEST_RUN_ID}`,
    },
  });
  await prisma.subscription.create({
    data: {
      organizationId: downgradedOrgId,
      stripeCustomerId: `stripe-cus-downgraded-${TEST_RUN_ID}`,
      plan: "PROFESSIONAL",
      subscriptionStatus: "CANCELED",
    },
  });

  await createProprietaryDataRecord(downgradedOrgId, USER_ID, {
    sourceKind: "KNOWLEDGE_BASE",
    title: "Left over from when this org was on Professional",
    content: "content",
    tags: [],
  });

  const records =
    await getProprietaryDataForOpportunityGeneration(downgradedOrgId);
  assert.deepEqual(records, []);

  await prisma.organization.delete({ where: { id: downgradedOrgId } });
});

test("BLOCKED (no real AI provider credential in this environment): generateOpportunityForEvent() runs the full real pre-LLM pipeline (profile + memory + billing-gated proprietary fetch + prompt assembly) without throwing, and fails gracefully instead of creating a corrupt or partial Opportunity row", async () => {
  await prisma.companyProfile.create({
    data: {
      organizationId: RADAR_ORG_ID,
      description: "We sell industrial cooling systems for data centers.",
      products: ["Cooling systems"],
    },
  });

  const entity = await createWatchedEntity(RADAR_ORG_ID, USER_ID, {
    name: `Acme Regression Co ${randomUUID().slice(0, 6)}`,
    watchReason: "PROSPECT",
    priority: 5,
    tags: [],
    notes: "",
    metadata: {},
  });

  const event = await prisma.externalEvent.create({
    data: {
      organizationId: RADAR_ORG_ID,
      externalEntityId: entity.id,
      type: "NEW_FACILITY",
      title: "Acme opens new Berlin data center",
      description: "Acme announced a new data center in Berlin.",
      occurredAt: new Date(),
      confidence: 0.8,
      evidence: [{ label: "Press release", sourceUrl: "https://example.com" }],
      source: "test",
      status: "NEW",
    },
  });

  // Not asserting anything about generated content - there is no real AI
  // provider credential in this environment, so the LLM call itself is
  // expected to fail. What this DOES verify honestly: the new proprietary-
  // data wiring (profile/memory/proprietary fetch, prompt assembly,
  // billing gate) runs against real Postgres without throwing, and the
  // function's pre-existing error handling still converts an LLM failure
  // into a clean {created:false, reason:"generation_failed"} rather than
  // a partially-written Opportunity row or an unhandled exception.
  const result = await generateOpportunityForEvent(RADAR_ORG_ID, event.id);
  assert.equal(result.created, false);
  assert.equal(result.reason, "generation_failed");

  const opportunityCount = await prisma.opportunity.count({
    where: { eventId: event.id },
  });
  assert.equal(opportunityCount, 0);

  // A generation_failed outcome (unlike not_relevant) leaves the event NEW
  // so a future pipeline run retries it, on the theory that the failure
  // was transient (e.g. an AI provider outage) rather than a considered
  // "not relevant" verdict - unchanged pre-existing behavior, confirmed
  // still true with the new proprietary-data wiring in the mix.
  const updatedEvent = await prisma.externalEvent.findUnique({
    where: { id: event.id },
  });
  assert.equal(updatedEvent?.status, "NEW");
});
