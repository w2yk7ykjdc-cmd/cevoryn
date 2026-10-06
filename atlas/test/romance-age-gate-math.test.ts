import assert from "node:assert/strict";
import test from "node:test";

import { isPlausibleVerificationTimestamp } from "../src/features/romance/player/age-gate-math";

test("null (never verified) is not plausible", () => {
  assert.equal(isPlausibleVerificationTimestamp(null), false);
});

test("a timestamp in the past is plausible", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const verifiedYesterday = new Date("2025-12-31T00:00:00Z");
  assert.equal(isPlausibleVerificationTimestamp(verifiedYesterday, now), true);
});

test("a timestamp exactly now is plausible", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  assert.equal(isPlausibleVerificationTimestamp(now, now), true);
});

test("a timestamp far in the future is malformed/untrusted, not treated as verified", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const tamperedFuture = new Date("2027-01-01T00:00:00Z");
  assert.equal(
    isPlausibleVerificationTimestamp(tamperedFuture, now),
    false
  );
});

test("a timestamp within ordinary clock-skew tolerance of the future is still accepted", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const slightlyAhead = new Date("2026-01-01T00:00:30.000Z"); // 30s ahead
  assert.equal(isPlausibleVerificationTimestamp(slightlyAhead, now), true);
});
