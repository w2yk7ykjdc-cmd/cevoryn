import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLlmEstimateEconomicImpact,
  calculateDeterministicEconomicImpact,
} from "../src/features/radar/opportunities/economic-impact-calculator";

test("computes a deterministic range when averageDealSize is a real usable number", () => {
  const result = calculateDeterministicEconomicImpact({
    averageDealSize: 100_000,
    probability: 0.5,
    economicPotential: 0.6,
    currency: "EUR",
  });

  assert.equal(result.basis, "DETERMINISTIC");
  // baseEstimate = 100_000 * 0.5 * 0.6 = 30_000
  assert.equal(result.valueRangeMin, Math.round(30_000 * 0.6));
  assert.equal(result.valueRangeMax, Math.round(30_000 * 1.4));
  assert.equal(result.currency, "EUR");
  assert.ok(result.inputs);
  assert.equal(result.inputs?.averageDealSize, 100_000);
  assert.equal(result.inputs?.lowMultiplier, 0.6);
  assert.equal(result.inputs?.highMultiplier, 1.4);
});

test("a DETERMINISTIC result carries code-derived assumptions, each sourced from real data - never from the LLM", () => {
  const result = calculateDeterministicEconomicImpact({
    averageDealSize: 100_000,
    probability: 0.5,
    economicPotential: 0.6,
    currency: "EUR",
  });

  assert.equal(result.assumptions.length, 3);
  const byKey = Object.fromEntries(result.assumptions.map((a) => [a.key, a]));
  assert.equal(
    byKey.average_deal_size?.source,
    "CompanyProfile.averageDealSize"
  );
  assert.match(byKey.average_deal_size?.value ?? "", /100,000/);
  assert.equal(byKey.probability?.source, "Opportunity.probability");
  assert.equal(byKey.probability?.value, "50%");
  assert.equal(
    byKey.economic_potential?.source,
    "Opportunity.economicPotential"
  );
  assert.equal(byKey.economic_potential?.value, "60%");
  // None of these sources is the LLM-estimate literal - a DETERMINISTIC
  // result must never carry an assumption attributed to the LLM.
  for (const assumption of result.assumptions) {
    assert.notEqual(assumption.source, "LLM_ESTIMATE_UNVALIDATED");
  }
});

test("valueRangeMin is always less than valueRangeMax for any valid deterministic input", () => {
  const result = calculateDeterministicEconomicImpact({
    averageDealSize: 50_000,
    probability: 0.8,
    economicPotential: 0.9,
    currency: "USD",
  });
  assert.equal(result.basis, "DETERMINISTIC");
  assert.ok(result.valueRangeMin !== null && result.valueRangeMax !== null);
  assert.ok(
    (result.valueRangeMin as number) < (result.valueRangeMax as number)
  );
});

test("returns INSUFFICIENT_DATA (never a guessed number) when averageDealSize is null", () => {
  const result = calculateDeterministicEconomicImpact({
    averageDealSize: null,
    probability: 0.7,
    economicPotential: 0.7,
    currency: "EUR",
  });
  assert.deepEqual(result, {
    basis: "INSUFFICIENT_DATA",
    valueRangeMin: null,
    valueRangeMax: null,
    currency: null,
    assumptions: [],
  });
});

test("returns INSUFFICIENT_DATA for a zero averageDealSize", () => {
  const result = calculateDeterministicEconomicImpact({
    averageDealSize: 0,
    probability: 0.5,
    economicPotential: 0.5,
    currency: "EUR",
  });
  assert.equal(result.basis, "INSUFFICIENT_DATA");
});

test("returns INSUFFICIENT_DATA for a negative averageDealSize", () => {
  const result = calculateDeterministicEconomicImpact({
    averageDealSize: -50_000,
    probability: 0.5,
    economicPotential: 0.5,
    currency: "EUR",
  });
  assert.equal(result.basis, "INSUFFICIENT_DATA");
});

test("returns INSUFFICIENT_DATA for NaN or Infinity averageDealSize", () => {
  assert.equal(
    calculateDeterministicEconomicImpact({
      averageDealSize: NaN,
      probability: 0.5,
      economicPotential: 0.5,
      currency: "EUR",
    }).basis,
    "INSUFFICIENT_DATA"
  );
  assert.equal(
    calculateDeterministicEconomicImpact({
      averageDealSize: Infinity,
      probability: 0.5,
      economicPotential: 0.5,
      currency: "EUR",
    }).basis,
    "INSUFFICIENT_DATA"
  );
});

test("returns INSUFFICIENT_DATA when probability or economicPotential is outside 0-1", () => {
  for (const field of ["probability", "economicPotential"] as const) {
    assert.equal(
      calculateDeterministicEconomicImpact({
        averageDealSize: 100_000,
        probability: 0.5,
        economicPotential: 0.5,
        currency: "EUR",
        [field]: 1.5,
      }).basis,
      "INSUFFICIENT_DATA",
      `${field} > 1 should be rejected`
    );
    assert.equal(
      calculateDeterministicEconomicImpact({
        averageDealSize: 100_000,
        probability: 0.5,
        economicPotential: 0.5,
        currency: "EUR",
        [field]: -0.1,
      }).basis,
      "INSUFFICIENT_DATA",
      `${field} < 0 should be rejected`
    );
  }
});

test("boundary values 0 and 1 for probability/economicPotential are valid, not rejected", () => {
  const result = calculateDeterministicEconomicImpact({
    averageDealSize: 100_000,
    probability: 0,
    economicPotential: 1,
    currency: "EUR",
  });
  assert.equal(result.basis, "DETERMINISTIC");
  // baseEstimate = 100_000 * 0 * 1 = 0
  assert.equal(result.valueRangeMin, 0);
  assert.equal(result.valueRangeMax, 0);
});

test("buildLlmEstimateEconomicImpact wraps the LLM's own range as LLM_ESTIMATE_UNVALIDATED, never DETERMINISTIC", () => {
  const result = buildLlmEstimateEconomicImpact({
    estimatedValueMin: 10_000,
    estimatedValueMax: 25_000,
    currency: "USD",
  });
  assert.equal(result.basis, "LLM_ESTIMATE_UNVALIDATED");
  assert.equal(result.valueRangeMin, 10_000);
  assert.equal(result.valueRangeMax, 25_000);
  assert.equal(result.currency, "USD");
  assert.equal(result.assumptions.length, 1);
  assert.equal(result.assumptions[0]?.source, "LLM_ESTIMATE_UNVALIDATED");
});

test("buildLlmEstimateEconomicImpact returns INSUFFICIENT_DATA (not a guess) when the LLM produced no range either", () => {
  const result = buildLlmEstimateEconomicImpact({
    estimatedValueMin: null,
    estimatedValueMax: null,
    currency: "EUR",
  });
  assert.deepEqual(result, {
    basis: "INSUFFICIENT_DATA",
    valueRangeMin: null,
    valueRangeMax: null,
    currency: null,
    assumptions: [],
  });
});

test("buildLlmEstimateEconomicImpact handles a one-sided LLM range (only min or only max)", () => {
  const onlyMin = buildLlmEstimateEconomicImpact({
    estimatedValueMin: 5_000,
    estimatedValueMax: null,
    currency: "EUR",
  });
  assert.equal(onlyMin.basis, "LLM_ESTIMATE_UNVALIDATED");
  assert.equal(onlyMin.valueRangeMin, 5_000);
  assert.equal(onlyMin.valueRangeMax, null);
});
