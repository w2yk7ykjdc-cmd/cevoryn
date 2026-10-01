/**
 * Real Postgres integration coverage for the Step 5 Proprietary Data
 * foundation: tenant-scoped CRUD, cross-tenant (IDOR) isolation, cascade
 * delete via Organization removal, delete/update idempotency, keyword
 * search, and the real Brain module's chat-context injection (including
 * its empty-state and content-truncation behavior). Exercises the actual
 * exported service/module functions against a real database, matching
 * the convention of every other suite in this directory - no Prisma
 * mocking, and no LLM call (the Brain module's getContext() only reads
 * from Postgres; it never calls an AI provider).
 *
 * Same safety rules as the other integration suites: requires
 * INTEGRATION_DATABASE_URL explicitly, refuses anything supabase.co-shaped,
 * excluded from default `npm test`, run via `npm run test:integration`.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import type { ProprietaryDataModule as ProprietaryDataModuleType } from "../../src/features/brain/proprietary-data/proprietary-data.module";
import type {
  createProprietaryDataRecord as CreateProprietaryDataRecordType,
  deleteProprietaryDataRecord as DeleteProprietaryDataRecordType,
  getProprietaryDataRecord as GetProprietaryDataRecordType,
  listProprietaryDataRecords as ListProprietaryDataRecordsType,
  searchProprietaryDataRecords as SearchProprietaryDataRecordsType,
  updateProprietaryDataRecord as UpdateProprietaryDataRecordType,
} from "../../src/features/enterprise/proprietary-data/proprietary-data.service";
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
const ORG_A_ID = `pdata-test-org-a-${TEST_RUN_ID}`;
const ORG_B_ID = `pdata-test-org-b-${TEST_RUN_ID}`;
const USER_ID = `pdata-test-user-${TEST_RUN_ID}`;
const OTHER_USER_ID = `pdata-test-other-user-${TEST_RUN_ID}`;

let prisma: typeof PrismaType;
let createProprietaryDataRecord: typeof CreateProprietaryDataRecordType;
let updateProprietaryDataRecord: typeof UpdateProprietaryDataRecordType;
let deleteProprietaryDataRecord: typeof DeleteProprietaryDataRecordType;
let getProprietaryDataRecord: typeof GetProprietaryDataRecordType;
let listProprietaryDataRecords: typeof ListProprietaryDataRecordsType;
let searchProprietaryDataRecords: typeof SearchProprietaryDataRecordsType;
let ProprietaryDataModule: typeof ProprietaryDataModuleType;

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
  updateProprietaryDataRecord = serviceModule.updateProprietaryDataRecord;
  deleteProprietaryDataRecord = serviceModule.deleteProprietaryDataRecord;
  getProprietaryDataRecord = serviceModule.getProprietaryDataRecord;
  listProprietaryDataRecords = serviceModule.listProprietaryDataRecords;
  searchProprietaryDataRecords = serviceModule.searchProprietaryDataRecords;

  const moduleModule =
    await import("../../src/features/brain/proprietary-data/proprietary-data.module");
  ProprietaryDataModule = moduleModule.ProprietaryDataModule;

  await prisma.organization.createMany({
    data: [
      {
        id: ORG_A_ID,
        name: "Proprietary Data Test Org A",
        slug: `pdata-test-a-${TEST_RUN_ID}`,
      },
      {
        id: ORG_B_ID,
        name: "Proprietary Data Test Org B",
        slug: `pdata-test-b-${TEST_RUN_ID}`,
      },
    ],
  });

  // getProprietaryDataForContext() (what ProprietaryDataModule.getContext
  // calls) is now billing-gated on RADAR - give ORG_A_ID a real,
  // active Professional-plan subscription so its chat-context tests below
  // keep exercising real data rather than the "no RADAR access" empty
  // path. ORG_B_ID deliberately gets none - it's only used for cross-tenant
  // CRUD/IDOR checks in this suite, never for getContext().
  await prisma.subscription.create({
    data: {
      organizationId: ORG_A_ID,
      stripeCustomerId: `stripe-cus-${TEST_RUN_ID}`,
      plan: "PROFESSIONAL",
      subscriptionStatus: "ACTIVE",
    },
  });
});

after(async () => {
  await prisma.organization.deleteMany({
    where: { id: { in: [ORG_A_ID, ORG_B_ID] } },
  });
  await prisma.$disconnect();
});

test("createProprietaryDataRecord persists a real, tenant-scoped row", async () => {
  const record = await createProprietaryDataRecord(ORG_A_ID, USER_ID, {
    sourceKind: "KNOWLEDGE_BASE",
    title: "Onboarding checklist",
    content: "Step 1: verify domain. Step 2: assign an owner.",
    tags: ["onboarding"],
  });

  assert.equal(record.organizationId, ORG_A_ID);
  assert.equal(record.addedByUserId, USER_ID);
  assert.equal(record.sourceKind, "KNOWLEDGE_BASE");
  assert.deepEqual(record.tags, ["onboarding"]);

  const fetched = await getProprietaryDataRecord(ORG_A_ID, record.id);
  assert.ok(fetched);
  assert.equal(fetched?.title, "Onboarding checklist");
});

test("tenant isolation: org B cannot get, update, or delete org A's record", async () => {
  const record = await createProprietaryDataRecord(ORG_A_ID, USER_ID, {
    sourceKind: "CRM",
    title: "Org A only",
    content: "This must never be visible to org B.",
    tags: [],
  });

  const crossTenantGet = await getProprietaryDataRecord(ORG_B_ID, record.id);
  assert.equal(crossTenantGet, null);

  const crossTenantUpdate = await updateProprietaryDataRecord(
    ORG_B_ID,
    record.id,
    { title: "Hijacked" },
    OTHER_USER_ID
  );
  assert.equal(crossTenantUpdate.count, 0);

  const crossTenantDelete = await deleteProprietaryDataRecord(
    ORG_B_ID,
    record.id,
    OTHER_USER_ID
  );
  assert.equal(crossTenantDelete.count, 0);

  // Untouched from org A's own perspective.
  const stillThere = await getProprietaryDataRecord(ORG_A_ID, record.id);
  assert.equal(stillThere?.title, "Org A only");
});

test("the same title is independent per organization (no cross-tenant dedup)", async () => {
  await createProprietaryDataRecord(ORG_A_ID, USER_ID, {
    sourceKind: "KNOWLEDGE_BASE",
    title: "Shared title across orgs",
    content: "Org A version",
    tags: [],
  });
  await createProprietaryDataRecord(ORG_B_ID, OTHER_USER_ID, {
    sourceKind: "KNOWLEDGE_BASE",
    title: "Shared title across orgs",
    content: "Org B version",
    tags: [],
  });

  const orgARecords = await listProprietaryDataRecords(ORG_A_ID);
  const orgBRecords = await listProprietaryDataRecords(ORG_B_ID);
  assert.ok(orgARecords.some((r) => r.content === "Org A version"));
  assert.ok(orgBRecords.some((r) => r.content === "Org B version"));
  assert.ok(!orgARecords.some((r) => r.content === "Org B version"));
});

test("updateProprietaryDataRecord updates within tenant and is a no-op on a nonexistent id", async () => {
  const record = await createProprietaryDataRecord(ORG_A_ID, USER_ID, {
    sourceKind: "KNOWLEDGE_BASE",
    title: "Original title",
    content: "Original content",
    tags: [],
  });

  const result = await updateProprietaryDataRecord(
    ORG_A_ID,
    record.id,
    { title: "Updated title" },
    USER_ID
  );
  assert.equal(result.count, 1);

  const fetched = await getProprietaryDataRecord(ORG_A_ID, record.id);
  assert.equal(fetched?.title, "Updated title");

  const noopResult = await updateProprietaryDataRecord(
    ORG_A_ID,
    "nonexistent-id",
    { title: "Should not apply" },
    USER_ID
  );
  assert.equal(noopResult.count, 0);
});

test("deleteProprietaryDataRecord is idempotent: a second delete affects zero rows", async () => {
  const record = await createProprietaryDataRecord(ORG_A_ID, USER_ID, {
    sourceKind: "KNOWLEDGE_BASE",
    title: "To be deleted twice",
    content: "content",
    tags: [],
  });

  const first = await deleteProprietaryDataRecord(ORG_A_ID, record.id, USER_ID);
  assert.equal(first.count, 1);

  const second = await deleteProprietaryDataRecord(
    ORG_A_ID,
    record.id,
    USER_ID
  );
  assert.equal(second.count, 0);

  const fetched = await getProprietaryDataRecord(ORG_A_ID, record.id);
  assert.equal(fetched, null);
});

test("cascade delete: removing an Organization removes its proprietary data records", async () => {
  const cascadeOrgId = `pdata-cascade-org-${TEST_RUN_ID}`;
  await prisma.organization.create({
    data: {
      id: cascadeOrgId,
      name: "Cascade Test Org",
      slug: `pdata-cascade-${TEST_RUN_ID}`,
    },
  });

  const record = await createProprietaryDataRecord(cascadeOrgId, USER_ID, {
    sourceKind: "KNOWLEDGE_BASE",
    title: "Should be cascade-deleted",
    content: "content",
    tags: [],
  });

  await prisma.organization.delete({ where: { id: cascadeOrgId } });

  const orphaned = await prisma.proprietaryDataRecord.findUnique({
    where: { id: record.id },
  });
  assert.equal(orphaned, null);
});

test("searchProprietaryDataRecords matches title/content via ILIKE and stays tenant-scoped", async () => {
  await createProprietaryDataRecord(ORG_A_ID, USER_ID, {
    sourceKind: "KNOWLEDGE_BASE",
    title: "Quarterly pricing strategy",
    content: "Discusses enterprise tier discounting for annual contracts.",
    tags: [],
  });
  await createProprietaryDataRecord(ORG_B_ID, OTHER_USER_ID, {
    sourceKind: "KNOWLEDGE_BASE",
    title: "Quarterly pricing strategy",
    content: "Org B's own pricing notes - must not appear in org A's results.",
    tags: [],
  });

  const results = await searchProprietaryDataRecords(ORG_A_ID, "pricing");
  assert.ok(results.length > 0);
  assert.ok(results.every((r) => r.organizationId === ORG_A_ID));

  const noMatch = await searchProprietaryDataRecords(
    ORG_A_ID,
    "no-such-term-xyz"
  );
  assert.equal(noMatch.length, 0);
});

test("ProprietaryDataModule.getContext returns empty string when the org has no records", async () => {
  const emptyOrgId = `pdata-empty-org-${TEST_RUN_ID}`;
  await prisma.organization.create({
    data: {
      id: emptyOrgId,
      name: "Empty Org",
      slug: `pdata-empty-${TEST_RUN_ID}`,
    },
  });

  const brainModule = new ProprietaryDataModule();
  const context = await brainModule.getContext({
    organizationId: emptyOrgId,
    userId: USER_ID,
    conversationId: "n/a",
    latestMessage: "hello",
  });
  assert.equal(context, "");

  await prisma.organization.delete({ where: { id: emptyOrgId } });
});

test("ProprietaryDataModule.getContext injects real records and truncates long content", async () => {
  const contextOrgId = `pdata-context-org-${TEST_RUN_ID}`;
  await prisma.organization.create({
    data: {
      id: contextOrgId,
      name: "Context Org",
      slug: `pdata-context-${TEST_RUN_ID}`,
    },
  });
  // getContext() is billing-gated on RADAR (see getProprietaryDataForContext)
  // - without this, the real records below would be invisible to it and
  // this test would be indistinguishable from the empty-org case above.
  await prisma.subscription.create({
    data: {
      organizationId: contextOrgId,
      stripeCustomerId: `stripe-cus-context-${TEST_RUN_ID}`,
      plan: "PROFESSIONAL",
      subscriptionStatus: "ACTIVE",
    },
  });

  await createProprietaryDataRecord(contextOrgId, USER_ID, {
    sourceKind: "KNOWLEDGE_BASE",
    title: "Short fact",
    content: "We were founded in 2019.",
    tags: [],
  });
  const longContent = "x".repeat(1000);
  await createProprietaryDataRecord(contextOrgId, USER_ID, {
    sourceKind: "DOCUMENT_STORE",
    title: "Long document",
    content: longContent,
    tags: [],
  });

  const brainModule = new ProprietaryDataModule();
  const context = await brainModule.getContext({
    organizationId: contextOrgId,
    userId: USER_ID,
    conversationId: "n/a",
    latestMessage: "tell me about us",
  });

  assert.ok(context.includes("Proprietary Data"));
  assert.ok(context.includes("Short fact"));
  assert.ok(context.includes("We were founded in 2019."));
  assert.ok(context.includes("Long document"));
  // The 1000-char record must be excerpted, not injected in full.
  assert.ok(!context.includes(longContent));
  assert.ok(context.includes("x".repeat(500)));

  await prisma.organization.delete({ where: { id: contextOrgId } });
});
