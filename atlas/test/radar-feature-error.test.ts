import assert from "node:assert/strict";
import test from "node:test";

import { FeatureAccessError } from "../src/features/billing/config/plans";
import { translateRadarFeatureError } from "../src/app/api/enterprise/proprietary-data/radar-feature-error";

test("a FeatureAccessError is translated into a 403 with the gate's code and a plan-upgrade message", async () => {
  const response = translateRadarFeatureError(
    new FeatureAccessError("STARTER", "RADAR")
  );

  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error.code, "FEATURE_NOT_AVAILABLE");
  assert.equal(
    body.error.message,
    "Proprietary data requires the Professional or Business plan."
  );
});

test("any other error is rethrown rather than swallowed into a 403", () => {
  const unrelated = new Error("Database connection lost");
  assert.throws(() => translateRadarFeatureError(unrelated), /Database connection lost/);
});

test("a non-Error thrown value is also rethrown as-is", () => {
  assert.throws(
    () => translateRadarFeatureError("not an error object"),
    (thrown: unknown) => thrown === "not an error object"
  );
});
