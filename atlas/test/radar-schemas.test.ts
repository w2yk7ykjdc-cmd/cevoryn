import assert from "node:assert/strict";
import test from "node:test";

import { createExternalEntitySchema } from "../src/features/radar/entities/schemas";
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
    createExternalEntitySchema.safeParse({ name: "Acme", watchReason: "PROSPECT" })
      .success,
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
