import assert from "node:assert/strict";
import test from "node:test";

import {
  assertFeatureAccess,
  canGenerateReport,
  canInviteMember,
  canUseBrain,
  FeatureAccessError,
  getPlanLimits,
  hasFeature,
} from "../src/features/billing/config/plans";

test("Starter allows a small team of up to three members", () => {
  assert.equal(getPlanLimits("STARTER").maxMembers, 3);
  assert.equal(canInviteMember("STARTER", 0), true);
  assert.equal(canInviteMember("STARTER", 2), true);
  assert.equal(canInviteMember("STARTER", 3), false);
});

test("Professional is the first plan with Brain and reports", () => {
  assert.equal(canUseBrain("STARTER"), false);
  assert.equal(canGenerateReport("STARTER"), false);
  assert.equal(canUseBrain("PROFESSIONAL"), true);
  assert.equal(canGenerateReport("PROFESSIONAL"), true);
});

test("Business enables advanced RBAC", () => {
  assert.equal(hasFeature("PROFESSIONAL", "ADVANCED_RBAC"), false);
  assert.equal(hasFeature("BUSINESS", "ADVANCED_RBAC"), true);
});

test("Feature assertions fail closed", () => {
  assert.throws(
    () => assertFeatureAccess("STARTER", "BRAIN"),
    (error: unknown) =>
      error instanceof FeatureAccessError &&
      error.code === "FEATURE_NOT_AVAILABLE"
  );
});
