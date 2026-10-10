import assert from "node:assert/strict";
import test from "node:test";

import { computeConfidence } from "../src/features/brain/trust/trust-math";
import {
  CONFIDENCE_LEVELS,
  getConfidenceLevel,
} from "../src/features/brain/trust/types";
import type { Evidence } from "../src/features/brain/trust/types";

function evidence(weight: number): Evidence {
  return {
    source: "conversation",
    sourceId: "test",
    excerpt: "",
    timestamp: new Date().toISOString(),
    weight,
  };
}

test("no evidence at all returns the fixed 0.1 floor", () => {
  assert.equal(computeConfidence([]), 0.1);
});

test("a single piece of evidence is capped at 0.4 regardless of its weight", () => {
  assert.equal(computeConfidence([evidence(0.9)]), 0.4);
  assert.equal(computeConfidence([evidence(1)]), 0.4);
});

test("two pieces of perfect-weight evidence clear the single-evidence 0.4 cap", () => {
  const result = computeConfidence([evidence(1), evidence(1)]);
  assert.equal(result, 0.75);
});

test("weaker evidence produces a proportionally lower confidence", () => {
  const result = computeConfidence([evidence(0.5), evidence(0.5), evidence(0.5)]);
  assert.ok(Math.abs(result - 0.4894736842105263) < 1e-9);
});

test("confidence never reaches 1.0 even with many pieces of perfect evidence", () => {
  const result = computeConfidence(Array.from({ length: 10 }, () => evidence(1)));
  assert.equal(result, 0.9);
  assert.ok(result < 1);

  // Even far more evidence than any real caller would ever supply still
  // never exceeds the hard 0.95 ceiling (the formula's own asymptote gets
  // there before the cap does, so it lands exactly on 0.95, not above it).
  const manyResult = computeConfidence(
    Array.from({ length: 1000 }, () => evidence(1))
  );
  assert.ok(manyResult <= 0.95);
  assert.ok(manyResult > result);
});

test("more evidence pieces increase confidence than fewer, at the same average weight", () => {
  const few = computeConfidence([evidence(0.7), evidence(0.7)]);
  const more = computeConfidence([
    evidence(0.7),
    evidence(0.7),
    evidence(0.7),
    evidence(0.7),
  ]);
  assert.ok(more > few);
});

test("current behavior: a negative weight is not clamped here and can pull confidence below zero", () => {
  // computeConfidence() itself trusts its input - weights are normally
  // clamped to [0,1] by the conversationEvidence/memoryEvidence/pulseEvidence
  // constructors before they ever reach here, but this pins what actually
  // happens if that invariant is ever violated, rather than leaving it
  // undocumented.
  const result = computeConfidence([evidence(-1), evidence(-1)]);
  assert.ok(result < 0);
});

test("getConfidenceLevel buckets scores at the documented thresholds", () => {
  assert.equal(getConfidenceLevel(CONFIDENCE_LEVELS.HIGH), "high");
  assert.equal(getConfidenceLevel(1), "high");
  assert.equal(getConfidenceLevel(CONFIDENCE_LEVELS.HIGH - 0.01), "medium");
  assert.equal(getConfidenceLevel(CONFIDENCE_LEVELS.MEDIUM), "medium");
  assert.equal(getConfidenceLevel(CONFIDENCE_LEVELS.MEDIUM - 0.01), "low");
  assert.equal(getConfidenceLevel(CONFIDENCE_LEVELS.LOW), "low");
  assert.equal(getConfidenceLevel(CONFIDENCE_LEVELS.LOW - 0.01), "insufficient");
  assert.equal(getConfidenceLevel(0), "insufficient");
});
