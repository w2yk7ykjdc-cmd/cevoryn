import assert from "node:assert/strict";
import test from "node:test";

import { calculateDeterministicEconomicImpact } from "../src/features/radar/opportunities/economic-impact-calculator";
import {
  asExternalEvidence,
  buildEconomicImpactRecord,
  buildProprietaryEvidence,
  mergeOpportunityEvidence,
  validateGeneratedOpportunity,
} from "../src/features/radar/opportunities/opportunity-generation-math";

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

test("asExternalEvidence tags every item EXTERNAL, including rows written before the field existed", () => {
  const rawEventEvidence = [
    { label: "Job posting: Senior Engineer", sourceUrl: "https://x.com/1" },
    { label: "Press release", excerpt: "Acme raises Series B" },
  ];
  const result = asExternalEvidence(rawEventEvidence);
  assert.equal(result.length, 2);
  assert.ok(result.every((item) => item.source === "EXTERNAL"));
  const [first, second] = result;
  assert.ok(first);
  assert.ok(second);
  assert.equal(first.label, "Job posting: Senior Engineer");
  assert.equal(first.sourceUrl, "https://x.com/1");
  assert.equal(second.excerpt, "Acme raises Series B");
});

test("asExternalEvidence ignores malformed entries and non-array input", () => {
  assert.deepEqual(asExternalEvidence(null), []);
  assert.deepEqual(asExternalEvidence("not an array"), []);
  assert.deepEqual(asExternalEvidence([{ noLabel: true }, 42, null]), []);
});

test("buildProprietaryEvidence tags every item PROPRIETARY and passes through the excerpt verbatim", () => {
  const result = buildProprietaryEvidence([
    {
      title: "Q3 pricing memo",
      excerpt: "Enterprise tier discounting...",
      url: "https://internal/doc",
    },
    { title: "Onboarding checklist", excerpt: "Step 1...", url: null },
  ]);
  assert.equal(result.length, 2);
  assert.ok(result.every((item) => item.source === "PROPRIETARY"));
  const [first, second] = result;
  assert.ok(first);
  assert.ok(second);
  assert.equal(first.label, "Q3 pricing memo");
  assert.equal(first.sourceUrl, "https://internal/doc");
  assert.equal(second.sourceUrl, undefined);
});

test("mergeOpportunityEvidence combines external and proprietary evidence without dropping or relabeling either", () => {
  const merged = mergeOpportunityEvidence(
    [{ label: "Signal A", sourceUrl: "https://ext/1" }],
    [{ title: "Internal doc", excerpt: "content", url: null }]
  );
  assert.equal(merged.length, 2);
  const [first, second] = merged;
  assert.ok(first);
  assert.ok(second);
  assert.equal(first.source, "EXTERNAL");
  assert.equal(first.label, "Signal A");
  assert.equal(second.source, "PROPRIETARY");
  assert.equal(second.label, "Internal doc");
});

test("mergeOpportunityEvidence with no proprietary records is identical to the external-only evidence", () => {
  const merged = mergeOpportunityEvidence([{ label: "Signal A" }], []);
  assert.equal(merged.length, 1);
  const [only] = merged;
  assert.ok(only);
  assert.equal(only.source, "EXTERNAL");
});

test("buildEconomicImpactRecord derives REVENUE_OPPORTUNITY for OPPORTUNITY polarity and links only PROPRIETARY evidence", () => {
  const calculated = calculateDeterministicEconomicImpact({
    averageDealSize: 100_000,
    probability: 0.5,
    economicPotential: 0.6,
    currency: "EUR",
  });
  const mergedEvidence = mergeOpportunityEvidence(
    [{ label: "Signal A" }, { label: "Signal B" }],
    [{ title: "Internal doc", excerpt: "content", url: null }]
  );

  const record = buildEconomicImpactRecord({
    calculated,
    polarity: "OPPORTUNITY",
    eventConfidence: 0.75,
    timeHorizon: "3-6 months",
    mergedEvidence,
  });

  assert.equal(record.basis, "DETERMINISTIC");
  assert.equal(record.impactType, "REVENUE_OPPORTUNITY");
  assert.equal(record.confidence, 0.75);
  assert.equal(record.timeHorizon, "3-6 months");
  // mergedEvidence is [EXTERNAL, EXTERNAL, PROPRIETARY] - only index 2
  // (the PROPRIETARY item) should be referenced.
  assert.deepEqual(record.evidenceRefs, [
    { evidenceIndex: 2, role: "supports_economic_estimate" },
  ]);
});

test("buildEconomicImpactRecord derives REVENUE_EXPOSURE for THREAT polarity", () => {
  const calculated = calculateDeterministicEconomicImpact({
    averageDealSize: 100_000,
    probability: 0.5,
    economicPotential: 0.6,
    currency: "EUR",
  });
  const record = buildEconomicImpactRecord({
    calculated,
    polarity: "THREAT",
    eventConfidence: 0.4,
    timeHorizon: "1-3 months",
    mergedEvidence: [],
  });
  assert.equal(record.impactType, "REVENUE_EXPOSURE");
  assert.deepEqual(record.evidenceRefs, []);
});

test("buildEconomicImpactRecord for INSUFFICIENT_DATA nulls out confidence/timeHorizon and produces no evidenceRefs, regardless of evidence present", () => {
  const calculated = calculateDeterministicEconomicImpact({
    averageDealSize: null,
    probability: 0.5,
    economicPotential: 0.6,
    currency: "EUR",
  });
  const mergedEvidence = mergeOpportunityEvidence(
    [],
    [{ title: "Internal doc", excerpt: "content", url: null }]
  );

  const record = buildEconomicImpactRecord({
    calculated,
    polarity: "OPPORTUNITY",
    eventConfidence: 0.9,
    timeHorizon: "6-12 months",
    mergedEvidence,
  });

  assert.equal(record.basis, "INSUFFICIENT_DATA");
  assert.equal(record.impactType, "INSUFFICIENT_DATA");
  assert.equal(record.confidence, null);
  assert.equal(record.timeHorizon, null);
  assert.deepEqual(record.evidenceRefs, []);
  assert.deepEqual(record.assumptions, []);
});
