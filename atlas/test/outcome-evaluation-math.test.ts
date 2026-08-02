import assert from "node:assert/strict";
import test from "node:test";

import {
  clampScore,
  computeEvalConfidence,
  validateResult,
} from "../src/features/brain/outcomes/outcome-evaluation-math";

test("validateResult accepts the three known outcome results", () => {
  assert.equal(validateResult("SUCCESS"), "SUCCESS");
  assert.equal(validateResult("FAILURE"), "FAILURE");
  assert.equal(validateResult("PARTIAL_SUCCESS"), "PARTIAL_SUCCESS");
});

test("validateResult falls back to NO_OUTCOME_YET for anything unrecognized", () => {
  assert.equal(validateResult("MAYBE"), "NO_OUTCOME_YET");
  assert.equal(validateResult(undefined), "NO_OUTCOME_YET");
  assert.equal(validateResult(42), "NO_OUTCOME_YET");
});

test("clampScore keeps a valid score as-is", () => {
  assert.equal(clampScore(0.73), 0.73);
});

test("clampScore clamps out-of-range numbers to [0, 1]", () => {
  assert.equal(clampScore(5), 1);
  assert.equal(clampScore(-2), 0);
});

test("clampScore defaults a non-numeric score to 0.5", () => {
  assert.equal(clampScore("high"), 0.5);
  assert.equal(clampScore(undefined), 0.5);
});

test("computeEvalConfidence is low with no evidence and a short outcome", () => {
  assert.equal(computeEvalConfidence(0, 5), 0.4);
});

test("computeEvalConfidence increases with more timeline evidence", () => {
  const sparse = computeEvalConfidence(1, 5);
  const rich = computeEvalConfidence(3, 5);
  assert.ok(rich > sparse);
});

test("computeEvalConfidence increases with a more detailed outcome report", () => {
  const brief = computeEvalConfidence(0, 5);
  const detailed = computeEvalConfidence(0, 60);
  assert.ok(detailed > brief);
});

test("computeEvalConfidence tops out at ~0.8 with maximum evidence and detail, under the 0.9 cap", () => {
  const maxed = computeEvalConfidence(10, 500);
  assert.ok(Math.abs(maxed - 0.8) < 1e-9);
  assert.ok(maxed <= 0.9);
});
