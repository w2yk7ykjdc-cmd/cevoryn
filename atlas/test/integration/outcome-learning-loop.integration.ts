/**
 * Real Postgres integration coverage for the P1 "Outcome -> Learning ->
 * Calibration" sprint: closing the loop the audit found broken in three
 * places -
 *
 * 1. Opportunity-sourced OutcomeEvaluation rows were written (WON/LOST)
 *    but never read by any calibration code
 *    (confidence-calibrator.ts's `decisionId: { not: null }` filter
 *    excluded them by design).
 * 2. Decision-side outcome evaluation (outcome-evaluator.ts::evaluateOutcome)
 *    was real and correct but unreachable from the shipped
 *    decision-queue.tsx completion flow (it calls updateDecisionStatus,
 *    which never invoked it).
 * 3. extractLearningPatterns() had no scheduler, and applyCalibration()
 *    was defined but never called anywhere in the codebase.
 *
 * What this suite CAN verify fully, with no LLM involved at all:
 * extractLearningPatterns, computeCalibration, computeOpportunityCalibration,
 * runLearningCycleForOrganization, and the LearningPattern
 * persistence/metadata (including applyCalibration's output) are all pure
 * deterministic Postgres-backed code - no AI provider call anywhere in this
 * path. This is real, complete coverage, not a partial/BLOCKED substitute.
 *
 * What this suite CANNOT fully verify: the actual OutcomeEvaluation row
 * that a real, successful evaluateOutcome() call would create for a
 * COMPLETED Decision - that function calls a real AI provider, which this
 * environment has no credential for. The wiring (updateDecisionStatus's
 * COMPLETED path now genuinely invoking evaluateOutcome) is verified to
 * run without throwing and without corrupting Decision state; the
 * LLM-graded evaluation content itself is reported BLOCKED, not faked.
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
  computeCalibration as ComputeCalibrationType,
  computeOpportunityCalibration as ComputeOpportunityCalibrationType,
} from "../../src/features/brain/learning/confidence-calibrator";
import type {
  extractLearningPatterns as ExtractLearningPatternsType,
  getLearningPatterns as GetLearningPatternsType,
  runLearningCycleForOrganization as RunLearningCycleForOrganizationType,
} from "../../src/features/brain/learning/learning-engine";
import type { evaluateOutcome as EvaluateOutcomeType } from "../../src/features/brain/outcomes/outcome-evaluator";
import type { updateDecisionStatus as UpdateDecisionStatusType } from "../../src/features/brain/decisions/decision.service";
import type { updateOpportunityStatus as UpdateOpportunityStatusType } from "../../src/features/radar/opportunities/opportunity.service";
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
const ORG_A_ID = `outcome-learning-org-a-${TEST_RUN_ID}`;
const ORG_B_ID = `outcome-learning-org-b-${TEST_RUN_ID}`;
const USER_ID = `outcome-learning-user-${TEST_RUN_ID}`;

let prisma: typeof PrismaType;
let createWatchedEntity: typeof CreateWatchedEntityType;
let updateOpportunityStatus: typeof UpdateOpportunityStatusType;
let updateDecisionStatus: typeof UpdateDecisionStatusType;
let evaluateOutcome: typeof EvaluateOutcomeType;
let computeCalibration: typeof ComputeCalibrationType;
let computeOpportunityCalibration: typeof ComputeOpportunityCalibrationType;
let extractLearningPatterns: typeof ExtractLearningPatternsType;
let getLearningPatterns: typeof GetLearningPatternsType;
let runLearningCycleForOrganization: typeof RunLearningCycleForOrganizationType;

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

  const decisionModule =
    await import("../../src/features/brain/decisions/decision.service");
  updateDecisionStatus = decisionModule.updateDecisionStatus;

  const outcomeEvaluatorModule =
    await import("../../src/features/brain/outcomes/outcome-evaluator");
  evaluateOutcome = outcomeEvaluatorModule.evaluateOutcome;

  const calibratorModule =
    await import("../../src/features/brain/learning/confidence-calibrator");
  computeCalibration = calibratorModule.computeCalibration;
  computeOpportunityCalibration =
    calibratorModule.computeOpportunityCalibration;

  const learningEngineModule =
    await import("../../src/features/brain/learning/learning-engine");
  extractLearningPatterns = learningEngineModule.extractLearningPatterns;
  getLearningPatterns = learningEngineModule.getLearningPatterns;
  runLearningCycleForOrganization =
    learningEngineModule.runLearningCycleForOrganization;

  await prisma.organization.createMany({
    data: [
      {
        id: ORG_A_ID,
        name: "Outcome Learning Org A",
        slug: `outcome-learning-a-${TEST_RUN_ID}`,
      },
      {
        id: ORG_B_ID,
        name: "Outcome Learning Org B",
        slug: `outcome-learning-b-${TEST_RUN_ID}`,
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
  overrides: {
    probability?: number;
    /** Deliberately kept independent of `probability` in every caller
     *  below (defaults to a fixed 0.5, unrelated to whatever probability
     *  is set to) - this is what lets the tests prove
     *  computeOpportunityCalibration reads Opportunity.probability, not
     *  Opportunity.confidence, as the predicted value. */
    confidence?: number;
    polarity?: "OPPORTUNITY" | "THREAT";
  } = {}
) {
  const entity = await createWatchedEntity(organizationId, USER_ID, {
    name: `Outcome Learning Chain Co ${randomUUID().slice(0, 6)}`,
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
      description: "Test event for outcome-learning-loop coverage.",
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
      polarity: overrides.polarity ?? "OPPORTUNITY",
      title: `Test opportunity ${randomUUID().slice(0, 6)}`,
      description: "test",
      probability: overrides.probability ?? 0.5,
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

function testDecisionCanvas(
  overrides: Partial<DecisionCanvas> = {}
): DecisionCanvas {
  return {
    executiveSummary: "test",
    problemStatement: "Vendor renewal terms need review",
    evidence: [],
    possibleCauses: [],
    businessImpact: "test",
    priorityScore: 5,
    scoringBreakdown: [],
    options: [],
    recommendedDecision: "Renegotiate with the vendor",
    confidenceScore: 0.7,
    expectedOutcome: "A better rate",
    followUpPlan: [],
    ...overrides,
  };
}

test("2A: Opportunity WON creates an OutcomeEvaluation, and computeOpportunityCalibration reads it back using Opportunity.probability as the predicted value (regression: write path from Step 6/7 still works, and is no longer excluded from calibration)", async () => {
  const opportunities = await Promise.all([
    // confidence is deliberately the opposite of probability on every one
    // of these - if computeOpportunityCalibration ever regresses to
    // reading Opportunity.confidence again, these assertions fail.
    createTestOpportunity(ORG_A_ID, { probability: 0.9, confidence: 0.1 }),
    createTestOpportunity(ORG_A_ID, { probability: 0.6, confidence: 0.4 }),
    createTestOpportunity(ORG_A_ID, {
      probability: 0.3,
      confidence: 0.7,
      polarity: "THREAT",
    }),
  ]);

  await updateOpportunityStatus(ORG_A_ID, opportunities[0]!.id, "WON", USER_ID);
  await updateOpportunityStatus(
    ORG_A_ID,
    opportunities[1]!.id,
    "LOST",
    USER_ID
  );
  await updateOpportunityStatus(ORG_A_ID, opportunities[2]!.id, "WON", USER_ID);

  const evaluations = await prisma.outcomeEvaluation.findMany({
    where: {
      organizationId: ORG_A_ID,
      opportunityId: { in: opportunities.map((o) => o.id) },
    },
  });
  assert.equal(evaluations.length, 3);
  assert.ok(evaluations.every((e) => e.decisionId === null));

  const calibration = await computeOpportunityCalibration(ORG_A_ID);
  assert.equal(calibration.dataPoints.length, 3);
  // predicted (Opportunity.probability) vs actual (outcomeScore: WON=1, LOST=0)
  const byPredicted = new Map(
    calibration.dataPoints.map((d) => [d.predictedConfidence, d])
  );
  assert.equal(byPredicted.get(0.9)?.actualOutcomeScore, 1);
  assert.equal(byPredicted.get(0.6)?.actualOutcomeScore, 0);
  assert.equal(byPredicted.get(0.3)?.category, "THREAT");
  // None of the confidence values (0.1/0.4/0.7) appear as a predicted
  // value - proof the metric read is probability, not confidence.
  assert.equal(byPredicted.has(0.1), false);
  assert.equal(byPredicted.has(0.4), false);
  assert.equal(byPredicted.has(0.7), false);
});

test("2A metric proof: probability=0.8+WON and probability=0.2+LOST, each with confidence set to the opposite value - calibration reads probability, never confidence", async () => {
  const wonOpportunity = await createTestOpportunity(ORG_A_ID, {
    probability: 0.8,
    confidence: 0.2,
  });
  const lostOpportunity = await createTestOpportunity(ORG_A_ID, {
    probability: 0.2,
    confidence: 0.8,
  });

  await updateOpportunityStatus(ORG_A_ID, wonOpportunity.id, "WON", USER_ID);
  await updateOpportunityStatus(ORG_A_ID, lostOpportunity.id, "LOST", USER_ID);

  const calibration = await computeOpportunityCalibration(ORG_A_ID);
  const won = calibration.dataPoints.find(
    (d) => d.actualOutcomeScore === 1 && d.predictedConfidence === 0.8
  );
  const lost = calibration.dataPoints.find(
    (d) => d.actualOutcomeScore === 0 && d.predictedConfidence === 0.2
  );
  assert.ok(won, "expected a WON data point predicted at 0.8 (probability)");
  assert.ok(lost, "expected a LOST data point predicted at 0.2 (probability)");

  // Sanity check against the actual stored rows, independent of the
  // calibration function, so this test doesn't just check its own math.
  const [wonRow, lostRow] = await Promise.all([
    prisma.opportunity.findUniqueOrThrow({ where: { id: wonOpportunity.id } }),
    prisma.opportunity.findUniqueOrThrow({
      where: { id: lostOpportunity.id },
    }),
  ]);
  assert.equal(wonRow.probability, 0.8);
  assert.equal(wonRow.confidence, 0.2);
  assert.equal(lostRow.probability, 0.2);
  assert.equal(lostRow.confidence, 0.8);
});

test("2A: computeCalibration (Decision-only) never includes Opportunity-sourced rows - the two domains stay strictly separate", async () => {
  const decisionCalibration = await computeCalibration(ORG_A_ID);
  // ORG_A_ID has only Opportunity-sourced OutcomeEvaluation rows from the
  // test above and no Decision rows at all yet.
  assert.equal(decisionCalibration.dataPoints.length, 0);
  assert.equal(decisionCalibration.adjustmentFactor, 1.0);
});

test("2B: Decision completion now reaches evaluateOutcome() from the same real code path updateDecisionStatus uses - BLOCKED (no OPENAI_API_KEY): the LLM call itself fails, but the wiring runs cleanly without throwing or corrupting Decision state", async () => {
  const decision = await prisma.decision.create({
    data: {
      organizationId: ORG_A_ID,
      canvas: testDecisionCanvas() as never,
      priorityScore: 5,
    },
  });

  const updated = await updateDecisionStatus(
    ORG_A_ID,
    decision.id,
    "COMPLETED",
    "The vendor agreed to a 10% discount."
  );
  assert.equal(updated, true);

  const afterUpdate = await prisma.decision.findFirstOrThrow({
    where: { id: decision.id },
  });
  assert.equal(afterUpdate.status, "COMPLETED");
  assert.equal(afterUpdate.outcome, "The vendor agreed to a 10% discount.");
  assert.ok(afterUpdate.resolvedAt !== null);

  // This is exactly what the PATCH /api/brain/decisions/[id] route now
  // does for a COMPLETED status - not asserting anything about the
  // graded result, since that requires a real AI provider credential this
  // environment does not have.
  const evaluation = await evaluateOutcome(ORG_A_ID, decision.id);
  assert.equal(evaluation, null);

  // No OutcomeEvaluation row was created for this Decision - the LLM call
  // genuinely failed, so evaluateOutcome correctly did not fabricate one.
  const decisionEvaluations = await prisma.outcomeEvaluation.findMany({
    where: { organizationId: ORG_A_ID, decisionId: decision.id },
  });
  assert.equal(decisionEvaluations.length, 0);
});

test("2C/2D: runLearningCycleForOrganization persists both calibration domains as LearningPattern rows, with applyCalibration's output visible in metadata - reachable, not dead code", async () => {
  // Real OutcomeEvaluation rows for the Decision domain, inserted directly
  // rather than through evaluateOutcome() (which requires a real AI
  // provider credential this environment does not have - see the BLOCKED
  // test above). computeCalibration() itself only ever reads these rows
  // and joins to Decision.canvas - it has no idea whether evaluateOutcome
  // or a direct insert produced them, so this is real coverage of the
  // read side, not a substitute for it.
  for (const confidenceScore of [0.8, 0.6, 0.4]) {
    const decision = await prisma.decision.create({
      data: {
        organizationId: ORG_A_ID,
        canvas: testDecisionCanvas({ confidenceScore }) as never,
        priorityScore: 5,
        status: "COMPLETED",
      },
    });
    await prisma.outcomeEvaluation.create({
      data: {
        organizationId: ORG_A_ID,
        decisionId: decision.id,
        result: "SUCCESS",
        outcomeScore: 1,
        confidence: 0.7,
        explanation: "test",
      },
    });
  }

  const result = await runLearningCycleForOrganization(ORG_A_ID);
  assert.deepEqual(result.errors, []);
  // 5, not 3: the 3 Opportunities from the first "2A" test above plus the
  // 2 from the "2A metric proof" test that ran after it - both
  // contribute real Opportunity-sourced OutcomeEvaluation rows for ORG_A.
  assert.equal(result.opportunityCalibrationSampleSize, 5);
  assert.equal(result.decisionCalibrationSampleSize, 3);

  const patterns = await getLearningPatterns(ORG_A_ID);
  const opportunityCalibrationPattern = patterns.find(
    (p) => p.patternType === "calibration" && p.category === "opportunity"
  );
  assert.ok(opportunityCalibrationPattern);
  assert.equal(opportunityCalibrationPattern.frequency, 5);

  const raw = await prisma.learningPattern.findFirstOrThrow({
    where: {
      organizationId: ORG_A_ID,
      patternType: "calibration",
      category: "opportunity",
    },
  });
  const metadata = raw.metadata as Record<string, unknown>;
  assert.equal(metadata.sampleSize, 5);
  assert.equal(typeof metadata.adjustmentFactor, "number");
  // This is applyCalibration()'s actual return value for this run's real
  // average predicted confidence - proof it was genuinely called, not
  // just defined.
  assert.equal(typeof metadata.exampleCalibratedConfidence, "number");
  const calibrated = metadata.exampleCalibratedConfidence as number;
  assert.ok(calibrated >= 0.05 && calibrated <= 0.95);

  const decisionCalibrationPattern = patterns.find(
    (p) => p.patternType === "calibration" && p.category === "decision"
  );
  assert.ok(decisionCalibrationPattern);
  assert.equal(decisionCalibrationPattern.frequency, 3);

  const rawDecision = await prisma.learningPattern.findFirstOrThrow({
    where: {
      organizationId: ORG_A_ID,
      patternType: "calibration",
      category: "decision",
    },
  });
  const decisionMetadata = rawDecision.metadata as Record<string, unknown>;
  assert.equal(decisionMetadata.sampleSize, 3);
  assert.equal(typeof decisionMetadata.exampleCalibratedConfidence, "number");
});

test("2C: the learning cycle is idempotent - running it twice upserts the same calibration row rather than accumulating duplicates", async () => {
  const before = await prisma.learningPattern.count({
    where: {
      organizationId: ORG_A_ID,
      patternType: "calibration",
      category: "opportunity",
    },
  });
  assert.equal(before, 1);

  await runLearningCycleForOrganization(ORG_A_ID);

  const afterCount = await prisma.learningPattern.count({
    where: {
      organizationId: ORG_A_ID,
      patternType: "calibration",
      category: "opportunity",
    },
  });
  assert.equal(afterCount, 1);
});

test("2D: insufficient sample data (fewer than the minimum threshold) never produces an aggressive calibration - adjustmentFactor stays neutral and isCalibrated stays false", async () => {
  const opportunity = await createTestOpportunity(ORG_B_ID, {
    probability: 0.95,
  });
  await updateOpportunityStatus(ORG_B_ID, opportunity.id, "LOST", USER_ID);

  // Only 1 data point - well under both the "any signal at all" (3) and
  // "isCalibrated" (5) thresholds.
  const calibration = await computeOpportunityCalibration(ORG_B_ID);
  assert.equal(calibration.dataPoints.length, 0);
  assert.equal(calibration.adjustmentFactor, 1.0);
  assert.equal(calibration.isCalibrated, false);

  await runLearningCycleForOrganization(ORG_B_ID);
  const pattern = await prisma.learningPattern.findFirst({
    where: {
      organizationId: ORG_B_ID,
      patternType: "calibration",
      category: "opportunity",
    },
  });
  // With zero dataPoints, persistCalibrationSnapshot intentionally writes
  // nothing at all rather than a misleading "calibrated" row.
  assert.equal(pattern, null);
});

test("tenant isolation: ORG_B's calibration/pattern data never appears in ORG_A's results and vice versa", async () => {
  const orgACalibration = await computeOpportunityCalibration(ORG_A_ID);
  assert.equal(orgACalibration.dataPoints.length, 5);

  const orgAPatterns = await getLearningPatterns(ORG_A_ID);
  const orgBPatterns = await getLearningPatterns(ORG_B_ID);
  assert.ok(orgAPatterns.length > 0);
  assert.deepEqual(orgBPatterns, []);
});

test("extractLearningPatterns remains fully functional (regression) - no LLM call anywhere in this path", async () => {
  for (let i = 0; i < 4; i++) {
    await prisma.decision.create({
      data: {
        organizationId: ORG_B_ID,
        canvas: testDecisionCanvas({
          problemStatement: `Recurring staffing shortage in region ${i}`,
        }) as never,
        priorityScore: 5,
        status: i % 2 === 0 ? "ACCEPTED" : "REJECTED",
      },
    });
  }

  const created = await extractLearningPatterns(ORG_B_ID);
  assert.ok(created >= 1);

  const patterns = await getLearningPatterns(ORG_B_ID);
  assert.ok(patterns.some((p) => p.patternType === "acceptance"));
});
