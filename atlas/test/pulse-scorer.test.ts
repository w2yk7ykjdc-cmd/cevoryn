import assert from "node:assert/strict";
import test from "node:test";

import { computePulseScore } from "../src/features/brain/pulse/pulse-scorer";
import type { PulseMetrics } from "../src/features/brain/core/types";

function metrics(overrides: Partial<PulseMetrics> = {}): PulseMetrics {
  return {
    conversationCount: 0,
    messageCount: 0,
    activeUserCount: 0,
    topTopics: [],
    avgResponseTimeMs: 0,
    tokenUsage: { input: 0, output: 0, total: 0 },
    ...overrides,
  };
}

test("zero activity is not treated as improving or declining", () => {
  // Velocity defaults to 50 ("no data") when avgResponseTimeMs is 0, so a
  // fully idle org still scores 15 (0.3 weight * 50), not 0.
  const result = computePulseScore(metrics(), null);
  assert.equal(result.score, 15);
  assert.equal(result.trend, "stable");
});

test("higher engagement, velocity, and coverage raise the score", () => {
  const low = computePulseScore(metrics({ conversationCount: 1, messageCount: 2 }), null);
  const high = computePulseScore(
    metrics({
      conversationCount: 5,
      messageCount: 20,
      activeUserCount: 3,
      avgResponseTimeMs: 1000,
    }),
    null
  );
  assert.ok(high.score > low.score);
});

test("trend compares against the previous period, not an absolute threshold", () => {
  const previous = metrics({ conversationCount: 1, messageCount: 2, activeUserCount: 1 });
  const improved = metrics({ conversationCount: 3, messageCount: 10, activeUserCount: 2 });
  const declined = metrics({ conversationCount: 0, messageCount: 0, activeUserCount: 0 });

  assert.equal(computePulseScore(improved, previous).trend, "improving");
  assert.equal(computePulseScore(declined, previous).trend, "declining");
  assert.equal(computePulseScore(previous, previous).trend, "stable");
});

test("dimensions always sum to the reported score via their weights", () => {
  const result = computePulseScore(
    metrics({ conversationCount: 2, messageCount: 8, activeUserCount: 2, avgResponseTimeMs: 3000 }),
    null
  );
  const weighted = Math.round(
    result.dimensions.reduce((sum, d) => sum + d.score * d.weight, 0)
  );
  assert.equal(result.score, weighted);
});

test("high token usage surfaces as a neutral contributor, not a health signal", () => {
  const result = computePulseScore(
    metrics({
      conversationCount: 5,
      messageCount: 20,
      activeUserCount: 3,
      tokenUsage: { input: 80_000, output: 30_000, total: 110_000 },
    }),
    null
  );
  const aiUsage = result.topContributors.find((c) => c.factor === "AI Usage");
  assert.ok(aiUsage);
  assert.equal(aiUsage?.impact, "neutral");
});
