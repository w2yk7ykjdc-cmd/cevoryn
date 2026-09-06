import assert from "node:assert/strict";
import test from "node:test";

import { normalizeCompanyName } from "../src/features/radar/entities/entity-normalization";

test("lowercases and trims", () => {
  assert.equal(normalizeCompanyName("  Acme Corp  "), "acme");
});

test("strips common legal suffixes", () => {
  assert.equal(normalizeCompanyName("Acme Inc."), "acme");
  assert.equal(normalizeCompanyName("Acme, Inc"), "acme");
  assert.equal(normalizeCompanyName("Acme LLC"), "acme");
  assert.equal(normalizeCompanyName("Acme GmbH"), "acme");
  assert.equal(normalizeCompanyName("Acme Ltd"), "acme");
});

test("treats variants of the same company as equal", () => {
  const a = normalizeCompanyName("Company X");
  const b = normalizeCompanyName("Company X Inc.");
  const c = normalizeCompanyName("Company X, Inc");
  assert.equal(a, b);
  assert.equal(b, c);
});

test("collapses internal whitespace", () => {
  assert.equal(normalizeCompanyName("Acme   Corp"), "acme");
});

test("does not treat different companies as equal", () => {
  assert.notEqual(
    normalizeCompanyName("Acme Corp"),
    normalizeCompanyName("Beta Corp")
  );
});
