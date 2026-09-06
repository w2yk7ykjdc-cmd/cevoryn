import assert from "node:assert/strict";
import test from "node:test";

import {
  createExternalEntitySchema,
  updateExternalEntitySchema,
} from "../src/features/radar/entities/schemas";
import { upsertCompanyProfileSchema } from "../src/features/radar/profile/schemas";
import { updateOpportunityStatusSchema } from "../src/features/radar/opportunities/schemas";

test("createExternalEntitySchema requires a non-empty name and a valid watchReason", () => {
  assert.equal(
    createExternalEntitySchema.safeParse({ name: "", watchReason: "PROSPECT" })
      .success,
    false
  );
  assert.equal(
    createExternalEntitySchema.safeParse({
      name: "Acme",
      watchReason: "NOT_A_REASON",
    }).success,
    false
  );
  assert.equal(
    createExternalEntitySchema.safeParse({
      name: "Acme",
      watchReason: "PROSPECT",
    }).success,
    true
  );
});

test("createExternalEntitySchema defaults metadata to an empty object", () => {
  const result = createExternalEntitySchema.safeParse({
    name: "Acme",
    watchReason: "CUSTOMER",
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.deepEqual(result.data.metadata, {});
  }
});

test("createExternalEntitySchema accepts watchlist priority/tags/notes and rejects out-of-range priority", () => {
  const withDefaults = createExternalEntitySchema.safeParse({
    name: "Acme",
    watchReason: "PROSPECT",
  });
  assert.equal(withDefaults.success, true);
  if (withDefaults.success) {
    assert.equal(withDefaults.data.priority, 5);
    assert.deepEqual(withDefaults.data.tags, []);
    assert.equal(withDefaults.data.notes, "");
  }

  assert.equal(
    createExternalEntitySchema.safeParse({
      name: "Acme",
      watchReason: "PROSPECT",
      priority: 0,
    }).success,
    false
  );
  assert.equal(
    createExternalEntitySchema.safeParse({
      name: "Acme",
      watchReason: "PROSPECT",
      priority: 11,
    }).success,
    false
  );
  assert.equal(
    createExternalEntitySchema.safeParse({
      name: "Acme",
      watchReason: "PROSPECT",
      priority: 1,
      tags: ["strategic", "key-account"],
      notes: "Met at conference in 2026.",
    }).success,
    true
  );
});

test("updateExternalEntitySchema allows toggling isPaused without touching other fields", () => {
  const result = updateExternalEntitySchema.safeParse({ isPaused: true });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.isPaused, true);
    assert.equal(result.data.priority, undefined);
  }
});

test("upsertCompanyProfileSchema caps description length", () => {
  const tooLong = "a".repeat(2001);
  assert.equal(
    upsertCompanyProfileSchema.safeParse({ description: tooLong }).success,
    false
  );
});

test("upsertCompanyProfileSchema defaults list fields to empty arrays", () => {
  const result = upsertCompanyProfileSchema.safeParse({});
  assert.equal(result.success, true);
  if (result.success) {
    assert.deepEqual(result.data.products, []);
    assert.deepEqual(result.data.competitors, []);
  }
});

test("upsertCompanyProfileSchema rejects a negative average deal size", () => {
  assert.equal(
    upsertCompanyProfileSchema.safeParse({ averageDealSize: -100 }).success,
    false
  );
});

test("upsertCompanyProfileSchema defaults preferredCurrency to EUR and rejects invalid codes", () => {
  const defaulted = upsertCompanyProfileSchema.safeParse({});
  assert.equal(defaulted.success, true);
  if (defaulted.success) {
    assert.equal(defaulted.data.preferredCurrency, "EUR");
  }

  assert.equal(
    upsertCompanyProfileSchema.safeParse({ preferredCurrency: "usd" }).success,
    true
  );
  const lowercase = upsertCompanyProfileSchema.safeParse({
    preferredCurrency: "usd",
  });
  if (lowercase.success) {
    assert.equal(lowercase.data.preferredCurrency, "USD");
  }

  assert.equal(
    upsertCompanyProfileSchema.safeParse({ preferredCurrency: "US" }).success,
    false
  );
  assert.equal(
    upsertCompanyProfileSchema.safeParse({ preferredCurrency: "12E" }).success,
    false
  );
});

test("upsertCompanyProfileSchema accepts the Phase 2 progressive-disclosure fields", () => {
  const result = upsertCompanyProfileSchema.safeParse({
    knownCustomers: ["Acme Corp"],
    growthObjectives: ["Enter EU market"],
    preferredOpportunities: ["Expansion"],
    excludedOpportunities: ["Layoffs"],
    companySize: "51-200",
    revenueRange: "$10M-$50M",
    customContext: "We prioritize enterprise deals over SMB.",
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.deepEqual(result.data.knownCustomers, ["Acme Corp"]);
    assert.equal(result.data.companySize, "51-200");
  }
});

test("updateOpportunityStatusSchema only accepts the defined status values", () => {
  for (const status of [
    "REVIEWING",
    "QUALIFIED",
    "ACTED_ON",
    "WON",
    "LOST",
    "DISMISSED",
  ]) {
    assert.equal(
      updateOpportunityStatusSchema.safeParse({ status }).success,
      true
    );
  }
  assert.equal(
    updateOpportunityStatusSchema.safeParse({ status: "NEW" }).success,
    false
  );
  assert.equal(
    updateOpportunityStatusSchema.safeParse({ status: "MADE_UP" }).success,
    false
  );
});
