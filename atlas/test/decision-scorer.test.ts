import assert from "node:assert/strict";
import test from "node:test";

import type {
  CalibrationData,
  CalibrationResult,
} from "../src/features/brain/learning/types";
import {
  applyDecisionConfidenceCalibration,
  computeDecisionScore,
  parseScoringResponse,
} from "../src/features/brain/decisions/decision-scorer";

function fullInput(score: number) {
  return {
    businessImpact: { score, reasoning: "r" },
    urgency: { score, reasoning: "r" },
    confidence: { score, reasoning: "r" },
    risk: { score, reasoning: "r" },
    companyContext: { score, reasoning: "r" },
  };
}

test("a uniform score across all dimensions produces that same weighted score", () => {
  const { score, dimensions } = computeDecisionScore(fullInput(8));
  assert.equal(score, 8);
  assert.equal(dimensions.length, 5);
});

test("weights sum to 1 so a max score across dimensions caps at 10", () => {
  const { score } = computeDecisionScore(fullInput(10));
  assert.equal(score, 10);
});

test("business impact is weighted higher than company context", () => {
  const highImpact = computeDecisionScore({
    ...fullInput(0),
    businessImpact: { score: 10, reasoning: "r" },
  });
  const highContext = computeDecisionScore({
    ...fullInput(0),
    companyContext: { score: 10, reasoning: "r" },
  });
  assert.ok(highImpact.score > highContext.score);
});

test("out-of-range scores are clamped to 0-10", () => {
  const { dimensions } = computeDecisionScore({
    ...fullInput(5),
    urgency: { score: 99, reasoning: "r" },
    risk: { score: -5, reasoning: "r" },
  });
  const urgency = dimensions.find((d) => d.name === "Urgency");
  const risk = dimensions.find((d) => d.name === "Risk");
  assert.equal(urgency?.score, 10);
  assert.equal(risk?.score, 0);
});

test("parseScoringResponse extracts well-formed dimensions", () => {
  const parsed = parseScoringResponse({
    businessImpact: { score: 7, reasoning: "growth" },
    urgency: { score: 3, reasoning: "later" },
    confidence: { score: 9, reasoning: "well evidenced" },
    risk: { score: 2, reasoning: "low" },
    companyContext: { score: 6, reasoning: "aligned" },
  });
  assert.equal(parsed.businessImpact.score, 7);
  assert.equal(parsed.businessImpact.reasoning, "growth");
});

test("parseScoringResponse defaults an incomplete dimension (missing reasoning) entirely", () => {
  const parsed = parseScoringResponse({ businessImpact: { score: 7 } });
  assert.equal(parsed.businessImpact.score, 5);
  assert.equal(parsed.businessImpact.reasoning, "No data available");
});

test("parseScoringResponse defaults a wholly missing dimension to a neutral score", () => {
  const parsed = parseScoringResponse({});
  assert.equal(parsed.urgency.score, 5);
  assert.equal(parsed.urgency.reasoning, "No data available");
});

test("parseScoringResponse clamps out-of-range AI-provided scores", () => {
  const parsed = parseScoringResponse({
    risk: { score: 500, reasoning: "runaway value" },
  });
  assert.equal(parsed.risk.score, 10);
});

function notCalibrated(
  adjustmentFactor = 1.0
): CalibrationResult<CalibrationData> {
  return { adjustmentFactor, dataPoints: [], isCalibrated: false };
}

function calibrated(
  adjustmentFactor: number
): CalibrationResult<CalibrationData> {
  return {
    adjustmentFactor,
    dataPoints: [
      {
        predictedConfidence: 0.9,
        actualOutcomeScore: 0,
        delta: 0.9,
        category: "Vendor renewal",
      },
    ],
    isCalibrated: true,
  };
}

test("applyDecisionConfidenceCalibration is a no-op (wasApplied: false, value unchanged) when the org is not yet calibrated", () => {
  const result = applyDecisionConfidenceCalibration(0.8, notCalibrated(0.7));
  assert.equal(result.rawConfidence, 0.8);
  assert.equal(result.calibratedConfidence, 0.8);
  assert.equal(result.wasApplied, false);
  assert.equal(result.adjustmentFactor, 1.0);
});

test("applyDecisionConfidenceCalibration applies the org's real adjustment factor once isCalibrated is true", () => {
  const result = applyDecisionConfidenceCalibration(0.9, calibrated(0.7));
  assert.equal(result.wasApplied, true);
  assert.equal(result.adjustmentFactor, 0.7);
  // applyCalibration(0.9, 0.7) = clamp(0.63, 0.05, 0.95) = 0.63
  assert.ok(Math.abs(result.calibratedConfidence - 0.63) < 1e-9);
});

test("applyDecisionConfidenceCalibration clamps the calibrated value to [0.05, 0.95] even at the extremes", () => {
  const high = applyDecisionConfidenceCalibration(0.99, calibrated(1.05));
  assert.equal(high.calibratedConfidence, 0.95);

  const low = applyDecisionConfidenceCalibration(0.1, calibrated(0.3));
  assert.equal(low.calibratedConfidence, 0.05);
});
