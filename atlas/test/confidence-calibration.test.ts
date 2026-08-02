import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCalibration,
  computeAdjustmentFactor,
} from "../src/features/brain/learning/confidence-calibration-math";

test("a small delta within the +/-0.05 band leaves confidence unadjusted", () => {
  assert.equal(computeAdjustmentFactor(0.05), 1.0);
  assert.equal(computeAdjustmentFactor(-0.05), 1.0);
  assert.equal(computeAdjustmentFactor(0), 1.0);
});

test("overconfidence reduces the adjustment factor below 1", () => {
  const factor = computeAdjustmentFactor(0.2);
  assert.ok(factor < 1.0);
  assert.equal(factor, 0.8);
});

test("severe overconfidence is floored at 0.7, never reduced further", () => {
  const factor = computeAdjustmentFactor(0.9);
  assert.equal(factor, 0.7);
});

test("underconfidence increases the adjustment factor above 1", () => {
  const factor = computeAdjustmentFactor(-0.1);
  assert.ok(factor > 1.0);
});

test("underconfidence correction is capped at 1.05 to prevent confidence inflation", () => {
  const factor = computeAdjustmentFactor(-5);
  assert.equal(factor, 1.05);
});

test("applyCalibration scales raw confidence by the adjustment factor", () => {
  assert.equal(applyCalibration(0.6, 0.8), 0.48);
});

test("applyCalibration never lets confidence exceed 0.95", () => {
  assert.equal(applyCalibration(0.99, 1.05), 0.95);
});

test("applyCalibration never lets confidence drop below 0.05", () => {
  assert.equal(applyCalibration(0.1, 0.1), 0.05);
});
