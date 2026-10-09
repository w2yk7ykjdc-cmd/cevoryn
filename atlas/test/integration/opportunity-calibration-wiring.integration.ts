/**
 * Real Postgres integration coverage for connecting the existing Outcome ->
 * Learning -> Calibration loop (see outcome-learning-loop.integration.ts)
 * to real Opportunity generation - the follow-up work explicitly deferred
 * when that loop was first wired up ("LearningPattern's effect on future
 * generation/scoring is separate design/implementation work").
 *
 * What "connected to scoring" means here, precisely: `Opportunity.probability`
 * (the one field computeOpportunityCalibration() is itself computed against
 * - see confidence-calibrator.ts's doc comment) is now calibrated, via
 * applyOpportunityProbabilityCalibration(), before it is persisted and
 * before it feeds calculateDeterministicEconomicImpact(). scoreOpportunity()
 * and its WEIGHTS/inputs are untouched by this change - probability was
 * never one of its inputs (relevance/strategicFit/economicPotential/timing/
 * confidence only), so "connect to scoring" is satisfied by construction:
 * the only real, correct target for a probability calibration IS
 * Opportunity.probability itself, not the composite score.
 *
 * What this suite CAN verify fully, with no LLM involved at all: real,
 * DB-backed computeOpportunityCalibration() output flowing through the pure
 * applyOpportunityProbabilityCalibration() and buildEconomicImpactRecord()
 * functions exactly as opportunity-generator.ts now calls them, including
 * a full round-trip of the resulting calibrated Opportunity.probability and
 * its traceability assumption entry through real Postgres.
 *
 * What this suite CANNOT verify: a real generateOpportunityForEvent() call
 * actually producing a calibrated Opportunity end-to-end - that requires a
 * successful LLM response first, which requires a real AI provider
 * credential this environment does not have. The regression check that the
 * pipeline (now with calibration wired in) still fails gracefully without
 * throwing or writing a partial row is already covered by the existing
 * BLOCKED test in opportunity-economic-impact.integration.ts and is not
 * duplicated here.
 *
 * Same safety rules as every other suite in this directory: requires
 * INTEGRATION_DATABASE_URL explicitly, refuses anything supabase.co-shaped,
 * excluded from default `npm test`, run via `npm run test:integration`.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import type { computeOpportunityCalibration as ComputeOpportunityCalibrationType } from "../../src/features/brain/learning/confidence-calibrator";
import type { createWatchedEntity as CreateWatchedEntityType } from "../../src/features/radar/entities/entity.service";
import type { calculateDeterministicEconomicImpact as CalculateDeterministicEconomicImpactType } from "../../src/features/radar/opportunities/economic-impact-calculator";
import type {
  applyOpportunityProbabilityCalibration as ApplyOpportunityProbabilityCalibrationType,
  buildEconomicImpactRecord as BuildEconomicImpactRecordType,
} from "../../src/features/radar/opportunities/opportunity-generation-math";
import type { updateOpportunityStatus as UpdateOpportunityStatusType } from "../../src/features/radar/opportunities/opportunity.service";
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
const ORG_CALIBRATED_ID = `calib-wiring-org-calibrated-${TEST_RUN_ID}`;
const ORG_UNCALIBRATED_ID = `calib-wiring-org-uncalibrated-${TEST_RUN_ID}`;
const ORG_DOMAIN_ISOLATION_ID = `calib-wiring-org-domain-isolation-${TEST_RUN_ID}`;
const USER_ID = `calib-wiring-user-${TEST_RUN_ID}`;

let prisma: typeof PrismaType;
let createWatchedEntity: typeof CreateWatchedEntityType;
let updateOpportunityStatus: typeof UpdateOpportunityStatusType;
let computeOpportunityCalibration: typeof ComputeOpportunityCalibrationType;
let applyOpportunityProbabilityCalibration: typeof ApplyOpportunityProbabilityCalibrationType;
let calculateDeterministicEconomicImpact: typeof CalculateDeterministicEconomicImpactType;
let buildEconomicImpactRecord: typeof BuildEconomicImpactRecordType;

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

  const opportunityModule =
    await import("../../src/features/radar/opportunities/opportunity.service");
  updateOpportunityStatus = opportunityModule.updateOpportunityStatus;

  const calibratorModule =
    await import("../../src/features/brain/learning/confidence-calibrator");
  computeOpportunityCalibration =
    calibratorModule.computeOpportunityCalibration;

  const generationMathModule =
    await import("../../src/features/radar/opportunities/opportunity-generation-math");
  applyOpportunityProbabilityCalibration =
    generationMathModule.applyOpportunityProbabilityCalibration;
  buildEconomicImpactRecord = generationMathModule.buildEconomicImpactRecord;

  const calculatorModule =
    await import("../../src/features/radar/opportunities/economic-impact-calculator");
  calculateDeterministicEconomicImpact =
    calculatorModule.calculateDeterministicEconomicImpact;

  await prisma.organization.createMany({
    data: [
      {
        id: ORG_CALIBRATED_ID,
        name: "Calibration Wiring Org (calibrated)",
        slug: `calib-wiring-calibrated-${TEST_RUN_ID}`,
      },
      {
        id: ORG_UNCALIBRATED_ID,
        name: "Calibration Wiring Org (uncalibrated)",
        slug: `calib-wiring-uncalibrated-${TEST_RUN_ID}`,
      },
      {
        id: ORG_DOMAIN_ISOLATION_ID,
        name: "Calibration Wiring Org (domain isolation)",
        slug: `calib-wiring-domain-isolation-${TEST_RUN_ID}`,
      },
    ],
  });
});

after(async () => {
  await prisma.organization.deleteMany({
    where: {
      id: {
        in: [ORG_CALIBRATED_ID, ORG_UNCALIBRATED_ID, ORG_DOMAIN_ISOLATION_ID],
      },
    },
  });
  await prisma.$disconnect();
});

async function createTestOpportunity(
  organizationId: string,
  overrides: { probability?: number; confidence?: number } = {}
) {
  const entity = await createWatchedEntity(organizationId, USER_ID, {
    name: `Calib Wiring Chain Co ${randomUUID().slice(0, 6)}`,
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
      description: "Test event for calibration->scoring wiring coverage.",
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
      probability: overrides.probability ?? 0.9,
      confidence: overrides.confidence ?? 0.5,
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
}

test("uncalibrated organization (fewer than 5 real outcomes): applyOpportunityProbabilityCalibration is a real no-op against genuine DB-backed calibration output", async () => {
  const opportunity = await createTestOpportunity(ORG_UNCALIBRATED_ID, {
    probability: 0.85,
  });
  await updateOpportunityStatus(
    ORG_UNCALIBRATED_ID,
    opportunity.id,
    "LOST",
    USER_ID
  );

  const calibration = await computeOpportunityCalibration(ORG_UNCALIBRATED_ID);
  assert.equal(calibration.isCalibrated, false);

  const rawProbability = 0.72;
  const application = applyOpportunityProbabilityCalibration(
    rawProbability,
    calibration
  );
  assert.equal(application.wasApplied, false);
  assert.equal(application.calibratedProbability, rawProbability);
  assert.equal(application.adjustmentFactor, 1.0);
});

test("opportunity calibration excludes outcomes that are also linked to a Decision", async () => {
  const opportunities = await Promise.all(
    Array.from({ length: 5 }, () =>
      createTestOpportunity(ORG_DOMAIN_ISOLATION_ID, {
        probability: 0.5,
        confidence: 0.5,
      })
    )
  );

  for (const opportunity of opportunities) {
    await prisma.outcomeEvaluation.create({
      data: {
        organizationId: ORG_DOMAIN_ISOLATION_ID,
        decisionId: null,
        opportunityId: opportunity.id,
        result: "PARTIAL_SUCCESS",
        outcomeScore: 0.5,
        confidence: 0.5,
        explanation: "Neutral calibration sample",
        evidence: [],
      },
    });
  }

  const crossDomainOpportunity = await createTestOpportunity(
    ORG_DOMAIN_ISOLATION_ID,
    { probability: 0.9, confidence: 0.9 }
  );
  await prisma.outcomeEvaluation.create({
    data: {
      organizationId: ORG_DOMAIN_ISOLATION_ID,
      decisionId: "cross-domain-decision-decoy",
      opportunityId: crossDomainOpportunity.id,
      result: "FAILURE",
      outcomeScore: 0,
      confidence: 0.9,
      explanation: "Deliberately malformed cross-domain sample",
      evidence: [],
    },
  });

  const calibration = await computeOpportunityCalibration(
    ORG_DOMAIN_ISOLATION_ID
  );
  assert.equal(calibration.dataPoints.length, 5);
  assert.equal(calibration.adjustmentFactor, 1);
  assert.equal(calibration.isCalibrated, true);
});

test("calibrated organization (>= 5 real, consistently-overconfident outcomes): applyOpportunityProbabilityCalibration genuinely reduces a fresh probability estimate", async () => {
  // 5 opportunities, all predicted at probability=0.9, all LOST - a
  // deliberately, consistently overconfident organization. avgDelta = 0.9,
  // so computeAdjustmentFactor(0.9) = max(0.7, 1.0 - 0.9) = 0.7.
  const opportunities = await Promise.all(
    Array.from({ length: 5 }, () =>
      createTestOpportunity(ORG_CALIBRATED_ID, {
        probability: 0.9,
        confidence: 0.1, // deliberately the opposite, same metric-proof discipline as outcome-learning-loop.integration.ts
      })
    )
  );
  for (const opportunity of opportunities) {
    await updateOpportunityStatus(
      ORG_CALIBRATED_ID,
      opportunity.id,
      "LOST",
      USER_ID
    );
  }

  const calibration = await computeOpportunityCalibration(ORG_CALIBRATED_ID);
  assert.equal(calibration.isCalibrated, true);
  assert.equal(calibration.dataPoints.length, 5);
  assert.ok(
    Math.abs(calibration.adjustmentFactor - 0.7) < 1e-9,
    `expected adjustmentFactor ~0.7, got ${calibration.adjustmentFactor}`
  );

  // A brand-new opportunity's raw LLM probability, not yet in the sample
  // above - proves calibration applies prospectively, not retroactively.
  const freshRawProbability = 0.8;
  const application = applyOpportunityProbabilityCalibration(
    freshRawProbability,
    calibration
  );
  assert.equal(application.wasApplied, true);
  assert.equal(application.rawProbability, freshRawProbability);
  assert.equal(application.adjustmentFactor, calibration.adjustmentFactor);
  // applyCalibration(0.8, 0.7) = clamp(0.56, 0.05, 0.95) = 0.56
  assert.ok(
    Math.abs(application.calibratedProbability - 0.56) < 1e-9,
    `expected calibratedProbability ~0.56, got ${application.calibratedProbability}`
  );
  assert.ok(application.calibratedProbability < freshRawProbability);
});

test("past Opportunity rows are never retroactively changed by a later calibration computation", async () => {
  const opportunitiesBefore = await prisma.opportunity.findMany({
    where: { organizationId: ORG_CALIBRATED_ID },
    select: { id: true, probability: true },
  });
  assert.ok(opportunitiesBefore.length > 0);
  // computeOpportunityCalibration is a pure read - calling it again must
  // not mutate any stored probability.
  await computeOpportunityCalibration(ORG_CALIBRATED_ID);
  const opportunitiesAfter = await prisma.opportunity.findMany({
    where: { organizationId: ORG_CALIBRATED_ID },
    select: { id: true, probability: true },
  });
  assert.deepEqual(opportunitiesBefore, opportunitiesAfter);
});

test("end-to-end wiring exactly as opportunity-generator.ts now performs it: real calibration -> calibrated probability -> deterministic economic impact -> traceable assumption -> real Postgres round-trip", async () => {
  const calibration = await computeOpportunityCalibration(ORG_CALIBRATED_ID);
  assert.equal(calibration.isCalibrated, true);

  const rawProbability = 0.85;
  const calibrationApplication = applyOpportunityProbabilityCalibration(
    rawProbability,
    calibration
  );
  assert.equal(calibrationApplication.wasApplied, true);
  const calibratedProbability = calibrationApplication.calibratedProbability;
  assert.notEqual(calibratedProbability, rawProbability);

  // Exactly the two consumption points opportunity-generator.ts now feeds
  // the calibrated value into.
  const deterministicImpact = calculateDeterministicEconomicImpact({
    averageDealSize: 200_000,
    probability: calibratedProbability,
    economicPotential: 0.6,
    currency: "EUR",
  });
  assert.equal(deterministicImpact.basis, "DETERMINISTIC");
  assert.equal(deterministicImpact.inputs?.probability, calibratedProbability);

  const economicImpact = buildEconomicImpactRecord({
    calculated: deterministicImpact,
    polarity: "OPPORTUNITY",
    eventConfidence: 0.8,
    timeHorizon: "3-6 months",
    mergedEvidence: [],
    calibrationApplication,
  });
  const calibrationAssumption = economicImpact.assumptions.find(
    (a) => a.source === "OpportunityCalibration.probability"
  );
  assert.ok(calibrationAssumption);

  const entity = await createWatchedEntity(ORG_CALIBRATED_ID, USER_ID, {
    name: `Calib Wiring End-to-End Co ${randomUUID().slice(0, 6)}`,
    watchReason: "PROSPECT",
    priority: 5,
    tags: [],
    notes: "",
    metadata: {},
  });
  const event = await prisma.externalEvent.create({
    data: {
      organizationId: ORG_CALIBRATED_ID,
      externalEntityId: entity.id,
      type: "NEW_FACILITY",
      title: "End-to-end wiring test event",
      description: "test",
      occurredAt: new Date(),
      confidence: 0.8,
      evidence: [],
      source: "test",
    },
  });

  const created = await prisma.opportunity.create({
    data: {
      organizationId: ORG_CALIBRATED_ID,
      externalEntityId: entity.id,
      eventId: event.id,
      polarity: "OPPORTUNITY",
      title: "End-to-end calibration wiring opportunity",
      description: "test",
      // The calibrated value, not the raw LLM one - exactly what
      // generateOpportunityForEvent() now stores.
      probability: calibratedProbability,
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
      economicImpact: economicImpact as never,
    },
  });

  const fetched = await prisma.opportunity.findUniqueOrThrow({
    where: { id: created.id },
  });
  assert.equal(fetched.probability, calibratedProbability);
  const storedImpact =
    fetched.economicImpact as unknown as typeof economicImpact;
  assert.ok(
    storedImpact.assumptions.some(
      (a) => a.source === "OpportunityCalibration.probability"
    )
  );
});

test("tenant isolation: ORG_UNCALIBRATED's calibration state is entirely unaffected by ORG_CALIBRATED's real outcome history", async () => {
  const calibration = await computeOpportunityCalibration(ORG_UNCALIBRATED_ID);
  assert.equal(calibration.isCalibrated, false);
  assert.equal(calibration.adjustmentFactor, 1.0);
});
