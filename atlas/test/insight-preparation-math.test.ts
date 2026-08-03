import assert from "node:assert/strict";
import test from "node:test";

import {
  clampInsightPriority,
  computeInsightConfidence,
  isValidRawInsight,
} from "../src/features/brain/insights/insight-preparation-math";
import type { RawInsight } from "../src/features/brain/insights/insight-preparation-math";

function insight(overrides: Partial<RawInsight> = {}): RawInsight {
  return {
    category: "TEAM",
    severity: "SUGGESTION",
    title: "A recurring theme",
    summary: "summary",
    description: "A detailed description of the pattern observed.",
    impact: "Could affect delivery timelines.",
    reasoning: "Seen across three separate conversations this week.",
    recommendedAction: "Schedule a retro.",
    priority: 6,
    ...overrides,
  };
}

test("isValidRawInsight accepts a well-formed insight", () => {
  assert.equal(isValidRawInsight(insight()), true);
});

test("isValidRawInsight rejects a missing title or description", () => {
  assert.equal(isValidRawInsight(insight({ title: "" })), false);
  assert.equal(isValidRawInsight(insight({ description: "" })), false);
});

test("isValidRawInsight rejects an unrecognized category", () => {
  assert.equal(isValidRawInsight(insight({ category: "MARKETING" })), false);
});

test("isValidRawInsight rejects an unrecognized severity", () => {
  assert.equal(isValidRawInsight(insight({ severity: "URGENT" })), false);
});

test("computeInsightConfidence is low for a thin insight with no evidence", () => {
  const score = computeInsightConfidence(
    insight({ reasoning: "short", impact: "x", priority: 3 }),
    0
  );
  assert.equal(score, 0.3);
});

test("computeInsightConfidence rewards detailed reasoning and impact", () => {
  const thin = computeInsightConfidence(
    insight({ reasoning: "short", impact: "x", priority: 3 }),
    0
  );
  const detailed = computeInsightConfidence(
    insight({
      reasoning: "A reasoning string well over twenty characters long.",
      impact: "A meaningfully long impact statement.",
      priority: 3,
    }),
    0
  );
  assert.ok(detailed > thin);
});

test("computeInsightConfidence rewards more evidence", () => {
  const sparse = computeInsightConfidence(insight(), 1);
  const rich = computeInsightConfidence(insight(), 3);
  assert.ok(rich > sparse);
});

test("computeInsightConfidence rewards high-priority insights", () => {
  const normal = computeInsightConfidence(insight({ priority: 5 }), 0);
  const urgent = computeInsightConfidence(insight({ priority: 9 }), 0);
  assert.ok(urgent > normal);
});

test("computeInsightConfidence caps at 0.95", () => {
  const score = computeInsightConfidence(
    insight({
      reasoning: "A reasoning string well over twenty characters long.",
      impact: "A meaningfully long impact statement.",
      priority: 10,
    }),
    5
  );
  assert.ok(score <= 0.95);
});

test("clampInsightPriority keeps an in-range priority as-is", () => {
  assert.equal(clampInsightPriority(7), 7);
});

test("clampInsightPriority clamps out-of-range priorities to [1, 10]", () => {
  assert.equal(clampInsightPriority(15), 10);
  assert.equal(clampInsightPriority(-3), 1);
});

test("clampInsightPriority defaults a falsy priority to 5", () => {
  assert.equal(clampInsightPriority(0), 5);
  assert.equal(clampInsightPriority(NaN), 5);
});
