/**
 * Real Postgres integration coverage for Step 7A: the deterministic
 * economic value foundation on Opportunity.economicImpact.
 *
 * What this suite CAN verify without a real AI provider credential:
 * - The new additive `economic_impact` column round-trips real JSON
 *   through real Postgres (migration actually works, not just parses).
 * - Feeding a real, DB-fetched CompanyProfile.averageDealSize into the
 *   pure calculator produces the expected DETERMINISTIC result - the
 *   wiring between "real stored data" and "the calculator" is correct,
 *   not just the calculator in isolation (already unit-tested).
 * - generateOpportunityForEvent() still runs its full pre-LLM pipeline
 *   (now including the new economic-impact computation path, which sits
 *   after the LLM call and is therefore itself unreachable without a
 *   real credential - see below) and still fails gracefully instead of
 *   creating a corrupt/partial row - a regression check, not new coverage
 *   of the calculation itself.
 *
 * What this suite CANNOT verify in this environment: the actual
 * `economicImpact` value written by a real, successful
 * generateOpportunityForEvent() call - that code path only runs after a
 * successful LLM response, which requires a real AI provider credential
 * this environment does not have. Reported as BLOCKED, not faked.
 *
 * Same safety rules as every other suite in this directory: requires
 * INTEGRATION_DATABASE_URL explicitly, refuses anything supabase.co-shaped,
 * excluded from default `npm test`, run via `npm run test:integration`.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import type { calculateDeterministicEconomicImpact as CalculateDeterministicEconomicImpactType } from "../../src/features/radar/opportunities/economic-impact-calculator";
import type { createWatchedEntity as CreateWatchedEntityType } from "../../src/features/radar/entities/entity.service";
import type { generateOpportunityForEvent as GenerateOpportunityForEventType } from "../../src/features/radar/opportunities/opportunity-generator";
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
const ORG_A_ID = `econ-impact-org-a-${TEST_RUN_ID}`;
const ORG_B_ID = `econ-impact-org-b-${TEST_RUN_ID}`;
const USER_ID = `econ-impact-user-${TEST_RUN_ID}`;

let prisma: typeof PrismaType;
let calculateDeterministicEconomicImpact: typeof CalculateDeterministicEconomicImpactType;
let createWatchedEntity: typeof CreateWatchedEntityType;
let generateOpportunityForEvent: typeof GenerateOpportunityForEventType;

before(async () => {
  process.env.DATABASE_URL = INTEGRATION_DATABASE_URL;
  process.env.DIRECT_URL =
    process.env.INTEGRATION_DIRECT_URL ?? INTEGRATION_DATABASE_URL;

  execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });

  const prismaModule = await import("../../src/lib/prisma");
  prisma = prismaModule.prisma;

  const calculatorModule =
    await import("../../src/features/radar/opportunities/economic-impact-calculator");
  calculateDeterministicEconomicImpact =
    calculatorModule.calculateDeterministicEconomicImpact;

  const entityModule =
    await import("../../src/features/radar/entities/entity.service");
  createWatchedEntity = entityModule.createWatchedEntity;

  const generatorModule =
    await import("../../src/features/radar/opportunities/opportunity-generator");
  generateOpportunityForEvent = generatorModule.generateOpportunityForEvent;

  await prisma.organization.createMany({
    data: [
      {
        id: ORG_A_ID,
        name: "Economic Impact Test Org A",
        slug: `econ-impact-a-${TEST_RUN_ID}`,
      },
      {
        id: ORG_B_ID,
        name: "Economic Impact Test Org B",
        slug: `econ-impact-b-${TEST_RUN_ID}`,
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

async function createTestOpportunityChain(organizationId: string) {
  const entity = await createWatchedEntity(organizationId, USER_ID, {
    name: `EconImpact Chain Co ${randomUUID().slice(0, 6)}`,
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
      description: "Test event for Step 7A economic impact coverage.",
      occurredAt: new Date(),
      confidence: 0.8,
      evidence: [],
      source: "test",
    },
  });

  return { entity, event };
}

test("economic_impact column round-trips a DETERMINISTIC-shaped JSON object through real Postgres", async () => {
  const { event } = await createTestOpportunityChain(ORG_A_ID);

  const economicImpact = {
    basis: "DETERMINISTIC" as const,
    valueRangeMin: 18_000,
    valueRangeMax: 42_000,
    currency: "EUR",
    inputs: {
      averageDealSize: 100_000,
      probability: 0.5,
      economicPotential: 0.6,
      lowMultiplier: 0.6,
      highMultiplier: 1.4,
    },
  };

  const created = await prisma.opportunity.create({
    data: {
      organizationId: ORG_A_ID,
      externalEntityId: event.externalEntityId,
      eventId: event.id,
      polarity: "OPPORTUNITY",
      title: "Round-trip test opportunity",
      description: "test",
      probability: 0.5,
      confidence: 0.8,
      strategicFit: 0.6,
      timeHorizon: "3-6 months",
      reasoning: "test",
      score: 0.6,
      scoreBreakdown: {
        relevance: 0.6,
        strategicFit: 0.6,
        economicPotential: 0.6,
        timing: 0.6,
        confidence: 0.6,
      },
      economicImpact,
    },
  });

  const fetched = await prisma.opportunity.findUniqueOrThrow({
    where: { id: created.id },
  });
  assert.deepEqual(fetched.economicImpact, economicImpact);
});

test("economic_impact is null for an Opportunity created without one (backward compatible)", async () => {
  const { event } = await createTestOpportunityChain(ORG_A_ID);

  const created = await prisma.opportunity.create({
    data: {
      organizationId: ORG_A_ID,
      externalEntityId: event.externalEntityId,
      eventId: event.id,
      polarity: "OPPORTUNITY",
      title: "No economic impact set",
      description: "test",
      probability: 0.5,
      confidence: 0.8,
      strategicFit: 0.6,
      timeHorizon: "3-6 months",
      reasoning: "test",
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

  assert.equal(created.economicImpact, null);
});

test("a real, DB-fetched CompanyProfile.averageDealSize feeds the calculator to a DETERMINISTIC result", async () => {
  await prisma.companyProfile.create({
    data: {
      organizationId: ORG_A_ID,
      description: "Sells industrial cooling systems.",
      products: ["Cooling systems"],
      averageDealSize: 200_000,
    },
  });

  const profile = await prisma.companyProfile.findUniqueOrThrow({
    where: { organizationId: ORG_A_ID },
  });

  const result = calculateDeterministicEconomicImpact({
    averageDealSize: profile.averageDealSize,
    probability: 0.4,
    economicPotential: 0.5,
    currency: profile.preferredCurrency,
  });

  assert.equal(result.basis, "DETERMINISTIC");
  // baseEstimate = 200_000 * 0.4 * 0.5 = 40_000
  assert.equal(result.valueRangeMin, Math.round(40_000 * 0.6));
  assert.equal(result.valueRangeMax, Math.round(40_000 * 1.4));
  assert.equal(result.currency, profile.preferredCurrency);
});

test("a real, DB-fetched CompanyProfile with no averageDealSize feeds the calculator to INSUFFICIENT_DATA", async () => {
  await prisma.companyProfile.create({
    data: {
      organizationId: ORG_B_ID,
      description: "No average deal size declared.",
      products: ["Something"],
      // averageDealSize intentionally omitted - defaults to null
    },
  });

  const profile = await prisma.companyProfile.findUniqueOrThrow({
    where: { organizationId: ORG_B_ID },
  });
  assert.equal(profile.averageDealSize, null);

  const result = calculateDeterministicEconomicImpact({
    averageDealSize: profile.averageDealSize,
    probability: 0.4,
    economicPotential: 0.5,
    currency: profile.preferredCurrency,
  });

  assert.equal(result.basis, "INSUFFICIENT_DATA");
  assert.equal(result.valueRangeMin, null);
  assert.equal(result.valueRangeMax, null);
});

test("tenant isolation regression: economic_impact values never leak across organizations", async () => {
  const orgAOpportunities = await prisma.opportunity.findMany({
    where: { organizationId: ORG_A_ID },
    select: { economicImpact: true },
  });
  assert.ok(orgAOpportunities.length > 0);
  const orgBOpportunities = await prisma.opportunity.findMany({
    where: { organizationId: ORG_B_ID },
  });
  assert.equal(orgBOpportunities.length, 0);
});

test("BLOCKED (no real AI provider credential in this environment): generateOpportunityForEvent() still runs its full pipeline without throwing and still fails gracefully with the new economic-impact code in place", async () => {
  const cappedOrgId = `econ-impact-regression-${TEST_RUN_ID}`;
  await prisma.organization.create({
    data: {
      id: cappedOrgId,
      name: "Regression Org",
      slug: `econ-impact-regression-${TEST_RUN_ID}`,
    },
  });
  await prisma.companyProfile.create({
    data: {
      organizationId: cappedOrgId,
      description: "We sell industrial cooling systems for data centers.",
      products: ["Cooling systems"],
      averageDealSize: 150_000,
    },
  });

  const { event } = await createTestOpportunityChain(cappedOrgId);

  // Not asserting anything about the computed economicImpact value - that
  // code path only runs after a successful LLM response, which requires a
  // real AI provider credential this environment does not have. This
  // confirms the pipeline (now with the new code merged in) still fails
  // gracefully rather than throwing or writing a partial row - the same
  // regression check Step 6 already established for this function.
  const result = await generateOpportunityForEvent(cappedOrgId, event.id);
  assert.equal(result.created, false);
  assert.equal(result.reason, "generation_failed");

  const opportunityCount = await prisma.opportunity.count({
    where: { eventId: event.id },
  });
  assert.equal(opportunityCount, 0);

  await prisma.organization.delete({ where: { id: cappedOrgId } });
});
