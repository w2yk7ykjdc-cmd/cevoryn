import assert from "node:assert/strict";
import test from "node:test";

import { validateGeneratedOpportunity } from "../src/features/radar/opportunities/opportunity-generation-math";

function validOpportunity(overrides: Record<string, unknown> = {}) {
  return {
    polarity: "OPPORTUNITY",
    title: "Acme's Berlin expansion needs cooling infrastructure",
    description: "New data center likely needs cooling systems.",
    estimatedValueMin: 250_000,
    estimatedValueMax: 700_000,
    currency: "EUR",
    probability: 0.6,
    timeHorizon: "3-6 months",
    reasoning: "Matches our industrial cooling product line.",
    relevance: 0.8,
    strategicFit: 0.7,
    economicPotential: 0.6,
    timing: 0.5,
    ...overrides,
  };
}

test("returns null for non-object input", () => {
  assert.equal(validateGeneratedOpportunity(null), null);
  assert.equal(validateGeneratedOpportunity("null"), null);
  assert.equal(validateGeneratedOpportunity(42), null);
});

test("accepts a well-formed opportunity", () => {
  const result = validateGeneratedOpportunity(validOpportunity());
  assert.ok(result);
  assert.equal(result?.polarity, "OPPORTUNITY");
  assert.equal(result?.currency, "EUR");
});

test("accepts THREAT polarity", () => {
  const result = validateGeneratedOpportunity(
    validOpportunity({ polarity: "THREAT" })
  );
  assert.equal(result?.polarity, "THREAT");
});

test("rejects an unrecognized polarity", () => {
  assert.equal(
    validateGeneratedOpportunity(validOpportunity({ polarity: "MAYBE" })),
    null
  );
});

test("rejects a title shorter than the minimum length", () => {
  assert.equal(
    validateGeneratedOpportunity(validOpportunity({ title: "Hi" })),
    null
  );
});

test("rejects any of the five score dimensions outside 0-1", () => {
  for (const field of [
    "probability",
    "relevance",
    "strategicFit",
    "economicPotential",
    "timing",
  ]) {
    assert.equal(
      validateGeneratedOpportunity(validOpportunity({ [field]: 1.5 })),
      null,
      `${field} > 1 should be rejected`
    );
    assert.equal(
      validateGeneratedOpportunity(validOpportunity({ [field]: -0.1 })),
      null,
      `${field} < 0 should be rejected`
    );
  }
});

test("rejects a value range where min is greater than max - an internally inconsistent estimate is worse than none", () => {
  const result = validateGeneratedOpportunity(
    validOpportunity({ estimatedValueMin: 700_000, estimatedValueMax: 250_000 })
  );
  assert.equal(result, null);
});

test("accepts a null value range (no fake precision required)", () => {
  const result = validateGeneratedOpportunity(
    validOpportunity({ estimatedValueMin: null, estimatedValueMax: null })
  );
  assert.ok(result);
  assert.equal(result?.estimatedValueMin, null);
  assert.equal(result?.estimatedValueMax, null);
});

test("rejects a negative value estimate", () => {
  const result = validateGeneratedOpportunity(
    validOpportunity({ estimatedValueMin: -100 })
  );
  assert.equal(result?.estimatedValueMin, null);
});

test("defaults an invalid or missing currency to EUR", () => {
  assert.equal(
    validateGeneratedOpportunity(validOpportunity({ currency: "not-a-code" }))
      ?.currency,
    "EUR"
  );
  assert.equal(
    validateGeneratedOpportunity(validOpportunity({ currency: undefined }))
      ?.currency,
    "EUR"
  );
});

test("uppercases a lowercase currency code", () => {
  assert.equal(
    validateGeneratedOpportunity(validOpportunity({ currency: "usd" }))
      ?.currency,
    "USD"
  );
});

test("passes through a well-formed recommendedAction and defaults a missing or invalid one to an empty string", () => {
  assert.equal(
    validateGeneratedOpportunity(
      validOpportunity({ recommendedAction: "Email their procurement lead." })
    )?.recommendedAction,
    "Email their procurement lead."
  );
  assert.equal(
    validateGeneratedOpportunity(
      validOpportunity({ recommendedAction: undefined })
    )?.recommendedAction,
    ""
  );
  assert.equal(
    validateGeneratedOpportunity(validOpportunity({ recommendedAction: 42 }))
      ?.recommendedAction,
    ""
  );
});
