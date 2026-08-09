import assert from "node:assert/strict";
import test from "node:test";

import { computeMetricsFromDecisions } from "../src/features/brain/learning/recommendation-metrics-math";
import type { DecisionMetricsInput } from "../src/features/brain/learning/recommendation-metrics-math";

function decision(
  overrides: Partial<DecisionMetricsInput>
): DecisionMetricsInput {
  return {
    status: "PROPOSED",
    canvas: {},
    priorityScore: 5,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    resolvedAt: null,
    ...overrides,
  };
}

test("returns all-zero metrics for an empty decision list", () => {
  const metrics = computeMetricsFromDecisions([]);
  assert.deepEqual(metrics, {
    totalRecommendations: 0,
    acceptanceRate: 0,
    successRate: 0,
    failureRate: 0,
    avgTimeToCompletionHours: 0,
    avgPriorityScore: 0,
    byCategory: {},
  });
});

test("acceptanceRate excludes PROPOSED, REJECTED, and IGNORED decisions", () => {
  const metrics = computeMetricsFromDecisions([
    decision({ status: "PROPOSED" }),
    decision({ status: "REJECTED" }),
    decision({ status: "IGNORED" }),
    decision({ status: "ACCEPTED" }),
  ]);
  assert.equal(metrics.acceptanceRate, 0.25);
});

test("successRate and failureRate are computed only over resolved decisions", () => {
  const metrics = computeMetricsFromDecisions([
    decision({ status: "SUCCESSFUL" }),
    decision({ status: "COMPLETED" }),
    decision({ status: "FAILED" }),
    decision({ status: "PROPOSED" }), // not resolved, excluded from the denominator
  ]);
  assert.equal(metrics.successRate, 2 / 3);
  assert.equal(metrics.failureRate, 1 / 3);
});

test("avgTimeToCompletionHours is 0 when nothing has resolvedAt set", () => {
  const metrics = computeMetricsFromDecisions([
    decision({ status: "PROPOSED", resolvedAt: null }),
  ]);
  assert.equal(metrics.avgTimeToCompletionHours, 0);
});

test("avgTimeToCompletionHours averages only decisions with a resolvedAt", () => {
  const metrics = computeMetricsFromDecisions([
    decision({
      createdAt: new Date("2026-01-01T00:00:00Z"),
      resolvedAt: new Date("2026-01-01T02:00:00Z"),
    }),
    decision({ resolvedAt: null }),
  ]);
  assert.equal(metrics.avgTimeToCompletionHours, 2);
});

test("avgPriorityScore is rounded to one decimal place", () => {
  const metrics = computeMetricsFromDecisions([
    decision({ priorityScore: 7.33 }),
    decision({ priorityScore: 7.34 }),
  ]);
  assert.equal(metrics.avgPriorityScore, 7.3);
});

test("byCategory groups decisions by the first scoring dimension's name", () => {
  const metrics = computeMetricsFromDecisions([
    decision({
      status: "SUCCESSFUL",
      canvas: { scoringBreakdown: [{ name: "Revenue" }] },
    }),
    decision({
      status: "FAILED",
      canvas: { scoringBreakdown: [{ name: "Revenue" }] },
    }),
    decision({ status: "SUCCESSFUL", canvas: {} }),
  ]);
  assert.deepEqual(metrics.byCategory, {
    Revenue: { count: 2, successRate: 0.5 },
    General: { count: 1, successRate: 1 },
  });
});
