import assert from "node:assert/strict";
import test from "node:test";

import { hasFeature } from "../src/features/billing/config/plans";
import { hasPermission } from "../src/lib/rbac";

test("all three roles can read Radar data", () => {
  assert.equal(hasPermission("OWNER", "radar:read"), true);
  assert.equal(hasPermission("ADMIN", "radar:read"), true);
  assert.equal(hasPermission("MEMBER", "radar:read"), true);
});

test("only OWNER and ADMIN can manage Radar (watchlist, company profile, opportunity status)", () => {
  assert.equal(hasPermission("OWNER", "radar:manage"), true);
  assert.equal(hasPermission("ADMIN", "radar:manage"), true);
  assert.equal(hasPermission("MEMBER", "radar:manage"), false);
});

test("RADAR is unavailable on Starter", () => {
  assert.equal(hasFeature("STARTER", "RADAR"), false);
});

test("RADAR is available on Professional and Business", () => {
  assert.equal(hasFeature("PROFESSIONAL", "RADAR"), true);
  assert.equal(hasFeature("BUSINESS", "RADAR"), true);
});

test("existing Starter/Professional/Business feature sets are unaffected by adding RADAR", () => {
  assert.equal(hasFeature("STARTER", "CHAT"), true);
  assert.equal(hasFeature("STARTER", "BRAIN"), false);
  assert.equal(hasFeature("PROFESSIONAL", "BRAIN"), true);
  assert.equal(hasFeature("BUSINESS", "ADVANCED_RBAC"), true);
});
