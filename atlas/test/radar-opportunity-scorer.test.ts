import assert from "node:assert/strict";
import test from "node:test";

import {
  scoreOpportunity,
  scoreToPriority,
} from "../src/features/radar/opportunities/opportunity-scorer";

test("a uniform score across all dimensions produces that same score", () => {
  const { score } = scoreOpportunity({
    relevance: 0.6,
    strategicFit: 0.6,
    economicPotential: 0.6,
    timing: 0.6,
    confidence: 0.6,
  });
  assert.equal(score, 0.6);
});

test("weights sum to 1 so a max score across dimensions caps at 1", () => {
  const { score } = scoreOpportunity({
    relevance: 1,
    strategicFit: 1,
    economicPotential: 1,
    timing: 1,
    confidence: 1,
  });
  assert.equal(score, 1);
});

test("a zero score across all dimensions produces zero", () => {
  const { score } = scoreOpportunity({
    relevance: 0,
    strategicFit: 0,
    economicPotential: 0,
    timing: 0,
    confidence: 0,
  });
  assert.equal(score, 0);
});

test("relevance is weighted higher than timing", () => {
  const highRelevance = scoreOpportunity({
    relevance: 1,
    strategicFit: 0,
    economicPotential: 0,
    timing: 0,
    confidence: 0,
  });
  const highTiming = scoreOpportunity({
    relevance: 0,
    strategicFit: 0,
    economicPotential: 0,
    timing: 1,
    confidence: 0,
  });
  assert.ok(highRelevance.score > highTiming.score);
});

test("out-of-range inputs are clamped to 0-1", () => {
  const { breakdown } = scoreOpportunity({
    relevance: 5,
    strategicFit: -5,
    economicPotential: 0.5,
    timing: 0.5,
    confidence: 0.5,
  });
  assert.equal(breakdown.relevance, 1);
  assert.equal(breakdown.strategicFit, 0);
});

test("NaN inputs are treated as zero rather than propagating NaN", () => {
  const { score, breakdown } = scoreOpportunity({
    relevance: Number.NaN,
    strategicFit: 0.5,
    economicPotential: 0.5,
    timing: 0.5,
    confidence: 0.5,
  });
  assert.equal(breakdown.relevance, 0);
  assert.ok(!Number.isNaN(score));
});

test("scoreToPriority maps a top score to priority 1 and a zero score to priority 10", () => {
  assert.equal(scoreToPriority(1), 1);
  assert.equal(scoreToPriority(0), 10);
});

test("scoreToPriority stays within the 1-10 range for any input", () => {
  for (const score of [-1, 0, 0.25, 0.5, 0.75, 1, 2]) {
    const priority = scoreToPriority(score);
    assert.ok(priority >= 1 && priority <= 10);
  }
});
