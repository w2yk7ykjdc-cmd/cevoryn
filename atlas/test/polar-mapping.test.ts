import assert from "node:assert/strict";
import test from "node:test";

import {
  getBillingPlanFromPolarProductId,
  mapPolarSubscriptionStatus,
  SUPPORTED_POLAR_EVENT_TYPES,
} from "../src/lib/polar/mapping";

const ORIGINAL_ENV = { ...process.env };

function withProductEnv<T>(fn: () => T): T {
  process.env.POLAR_PRODUCT_STARTER = "prod_starter_test";
  process.env.POLAR_PRODUCT_PROFESSIONAL = "prod_professional_test";
  process.env.POLAR_PRODUCT_BUSINESS = "prod_business_test";
  try {
    return fn();
  } finally {
    process.env = { ...ORIGINAL_ENV };
  }
}

test("Starter purchase: known Starter product id maps to the STARTER plan", () => {
  withProductEnv(() => {
    assert.equal(
      getBillingPlanFromPolarProductId("prod_starter_test"),
      "STARTER"
    );
  });
});

test("Professional purchase: known Professional product id maps to the PROFESSIONAL plan", () => {
  withProductEnv(() => {
    assert.equal(
      getBillingPlanFromPolarProductId("prod_professional_test"),
      "PROFESSIONAL"
    );
  });
});

test("Business purchase: known Business product id maps to the BUSINESS plan", () => {
  withProductEnv(() => {
    assert.equal(
      getBillingPlanFromPolarProductId("prod_business_test"),
      "BUSINESS"
    );
  });
});

test("unknown product: an unconfigured product id maps to null, never guessed", () => {
  withProductEnv(() => {
    assert.equal(
      getBillingPlanFromPolarProductId("prod_never_configured"),
      null
    );
  });
});

test("plan change: active status maps to ACTIVE", () => {
  assert.equal(mapPolarSubscriptionStatus("active"), "ACTIVE");
});

test("cancellation: canceled status maps to CANCELED", () => {
  assert.equal(mapPolarSubscriptionStatus("canceled"), "CANCELED");
});

test("payment status change: past_due status maps to PAST_DUE", () => {
  assert.equal(mapPolarSubscriptionStatus("past_due"), "PAST_DUE");
});

test("an unrecognized status string never crashes - falls back to INCOMPLETE", () => {
  assert.equal(mapPolarSubscriptionStatus("some_future_status"), "INCOMPLETE");
  assert.equal(mapPolarSubscriptionStatus(undefined), "INCOMPLETE");
});

test("the webhook route only acts on the real, SDK-verified subscription lifecycle events", () => {
  assert.equal(SUPPORTED_POLAR_EVENT_TYPES.has("subscription.created"), true);
  assert.equal(SUPPORTED_POLAR_EVENT_TYPES.has("subscription.active"), true);
  assert.equal(SUPPORTED_POLAR_EVENT_TYPES.has("subscription.updated"), true);
  assert.equal(SUPPORTED_POLAR_EVENT_TYPES.has("subscription.canceled"), true);
  assert.equal(
    SUPPORTED_POLAR_EVENT_TYPES.has("subscription.uncanceled"),
    true
  );
  assert.equal(SUPPORTED_POLAR_EVENT_TYPES.has("subscription.revoked"), true);
  assert.equal(SUPPORTED_POLAR_EVENT_TYPES.has("subscription.past_due"), true);
  // Real Polar events this integration deliberately does not act on.
  assert.equal(SUPPORTED_POLAR_EVENT_TYPES.has("checkout.created"), false);
  assert.equal(SUPPORTED_POLAR_EVENT_TYPES.has("order.paid"), false);
});
