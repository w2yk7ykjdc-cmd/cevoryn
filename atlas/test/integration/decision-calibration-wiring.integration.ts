/**
 * Real Postgres integration coverage for connecting the Decision-domain
 * half of the Outcome -> Learning -> Calibration loop to real canvas
 * generation - the Decision-side counterpart of
 * opportunity-calibration-wiring.integration.ts. A read-only audit found
 * that computeCalibration() (confidence-calibrator.ts) was computed and
 * persisted as a LearningPattern snapshot, but never fed back into
 * decision-canvas.ts's confidenceScore - unlike the Opportunity domain,
 * which already closed this loop for Opportunity.probability.
 *
 * What "connected to generation" means here, precisely:
 * decision-canvas.ts now applies applyDecisionConfidenceCalibration() (the
 * Decision-domain mirror of applyOpportunityProbabilityCalibration()) to
 * the LLM's raw confidenceScore before it's persisted on the canvas.
 * computeDecisionScore()'s five weighted dimensions - including its own,
 * separately-sourced "Confidence" dimension - are untouched; this only
 * ever adjusts the one field calibration is itself computed against.
 *
 * What this suite CAN verify fully, with no LLM involved at all: real,
 * DB-backed computeCalibration() output flowing through the pure
 * applyDecisionConfidenceCalibration() function exactly as
 * decision-canvas.ts now calls it.
 *
 * What this suite CANNOT verify: a real generateDecisionCanvas() call
 * actually producing a calibrated canvas end-to-end - that requires a
 * successful LLM response first, which requires a real AI provider
 * credential this environment does not have.
 *
 * Same safety rules as every other suite in this directory: requires
 * INTEGRATION_DATABASE_URL explicitly, refuses anything supabase.co-shaped,
 * excluded from default `npm test`, run via `npm run test:integration`.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import type { computeCalibration as ComputeCalibrationType } from "../../src/features/brain/learning/confidence-calibrator";
import type { applyDecisionConfidenceCalibration as ApplyDecisionConfidenceCalibrationType } from "../../src/features/brain/decisions/decision-scorer";
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
const ORG_CALIBRATED_ID = `decision-calib-wiring-calibrated-${TEST_RUN_ID}`;
const ORG_UNCALIBRATED_ID = `decision-calib-wiring-uncalibrated-${TEST_RUN_ID}`;

let prisma: typeof PrismaType;
let computeCalibration: typeof ComputeCalibrationType;
let applyDecisionConfidenceCalibration: typeof ApplyDecisionConfidenceCalibrationType;

function testCanvas(confidenceScore: number): DecisionCanvas {
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
    confidenceScore,
    expectedOutcome: "A better rate",
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

  const calibratorModule =
    await import("../../src/features/brain/learning/confidence-calibrator");
  computeCalibration = calibratorModule.computeCalibration;

  const decisionScorerModule =
    await import("../../src/features/brain/decisions/decision-scorer");
  applyDecisionConfidenceCalibration =
    decisionScorerModule.applyDecisionConfidenceCalibration;

  await prisma.organization.createMany({
    data: [
      {
        id: ORG_CALIBRATED_ID,
        name: "Decision Calibration Wiring Org (calibrated)",
        slug: `decision-calib-wiring-calibrated-${TEST_RUN_ID}`,
      },
      {
        id: ORG_UNCALIBRATED_ID,
        name: "Decision Calibration Wiring Org (uncalibrated)",
        slug: `decision-calib-wiring-uncalibrated-${TEST_RUN_ID}`,
      },
    ],
  });
});

after(async () => {
  await prisma.organization.deleteMany({
    where: { id: { in: [ORG_CALIBRATED_ID, ORG_UNCALIBRATED_ID] } },
  });
  await prisma.$disconnect();
});

async function createCompletedDecisionWithOutcome(
  organizationId: string,
  confidenceScore: number,
  outcomeScore: number
) {
  const decision = await prisma.decision.create({
    data: {
      organizationId,
      canvas: testCanvas(confidenceScore) as never,
      priorityScore: 5,
      status: "COMPLETED",
    },
  });
  await prisma.outcomeEvaluation.create({
    data: {
      organizationId,
      decisionId: decision.id,
      result: outcomeScore >= 1 ? "SUCCESS" : "FAILURE",
      outcomeScore,
      confidence: 0.7,
      explanation: "test",
    },
  });
  return decision;
}

test("uncalibrated organization (fewer than 5 real completed-decision outcomes): applyDecisionConfidenceCalibration is a real no-op against genuine DB-backed calibration output", async () => {
  await createCompletedDecisionWithOutcome(ORG_UNCALIBRATED_ID, 0.85, 0);

  const calibration = await computeCalibration(ORG_UNCALIBRATED_ID);
  assert.equal(calibration.isCalibrated, false);

  const rawConfidence = 0.72;
  const application = applyDecisionConfidenceCalibration(
    rawConfidence,
    calibration
  );
  assert.equal(application.wasApplied, false);
  assert.equal(application.calibratedConfidence, rawConfidence);
  assert.equal(application.adjustmentFactor, 1.0);
});

test("calibrated organization (>= 5 real, consistently-overconfident completed decisions): applyDecisionConfidenceCalibration genuinely reduces a fresh confidenceScore", async () => {
  // 5 decisions, all predicted at confidenceScore=0.9, all FAILED
  // (outcomeScore=0) - a deliberately, consistently overconfident
  // organization. avgDelta = 0.9, so computeAdjustmentFactor(0.9) =
  // max(0.7, 1.0 - 0.9) = 0.7.
  for (let i = 0; i < 5; i += 1) {
    await createCompletedDecisionWithOutcome(ORG_CALIBRATED_ID, 0.9, 0);
  }

  const calibration = await computeCalibration(ORG_CALIBRATED_ID);
  assert.equal(calibration.isCalibrated, true);
  assert.equal(calibration.dataPoints.length, 5);
  assert.ok(
    Math.abs(calibration.adjustmentFactor - 0.7) < 1e-9,
    `expected adjustmentFactor ~0.7, got ${calibration.adjustmentFactor}`
  );

  // A brand-new canvas's raw confidenceScore, not yet in the sample above
  // - proves calibration applies prospectively, not retroactively.
  const freshRawConfidence = 0.8;
  const application = applyDecisionConfidenceCalibration(
    freshRawConfidence,
    calibration
  );
  assert.equal(application.wasApplied, true);
  assert.equal(application.adjustmentFactor, calibration.adjustmentFactor);
  // applyCalibration(0.8, 0.7) = clamp(0.56, 0.05, 0.95) = 0.56
  assert.ok(
    Math.abs(application.calibratedConfidence - 0.56) < 1e-9,
    `expected calibratedConfidence ~0.56, got ${application.calibratedConfidence}`
  );
  assert.ok(application.calibratedConfidence < freshRawConfidence);
});

test("past Decision rows are never retroactively changed by a later calibration computation", async () => {
  const decisionsBefore = await prisma.decision.findMany({
    where: { organizationId: ORG_CALIBRATED_ID },
    select: { id: true, canvas: true },
  });
  assert.ok(decisionsBefore.length > 0);

  await computeCalibration(ORG_CALIBRATED_ID);

  const decisionsAfter = await prisma.decision.findMany({
    where: { organizationId: ORG_CALIBRATED_ID },
    select: { id: true, canvas: true },
  });
  assert.deepEqual(decisionsBefore, decisionsAfter);
});

test("tenant isolation: ORG_UNCALIBRATED's calibration state is entirely unaffected by ORG_CALIBRATED's real outcome history", async () => {
  const calibration = await computeCalibration(ORG_UNCALIBRATED_ID);
  assert.equal(calibration.isCalibrated, false);
  assert.equal(calibration.adjustmentFactor, 1.0);
});
