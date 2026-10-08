import assert from "node:assert/strict";
import test from "node:test";

import {
  getBillingPlanFromPolarProductId,
  getRomancePlanFromPolarProductId,
  mapPolarStatusToRomanceStatus,
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

test("regression: a trailing newline/space on the configured env var still matches", () => {
  process.env.POLAR_PRODUCT_STARTER = "prod_starter_test\n";
  process.env.POLAR_PRODUCT_PROFESSIONAL = " prod_professional_test ";
  process.env.POLAR_PRODUCT_BUSINESS = "prod_business_test";
  try {
    assert.equal(
      getBillingPlanFromPolarProductId("prod_starter_test"),
      "STARTER"
    );
    assert.equal(
      getBillingPlanFromPolarProductId("prod_professional_test"),
      "PROFESSIONAL"
    );
  } finally {
    process.env = { ...ORIGINAL_ENV };
  }
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

test("Romance purchase: the configured Romance Premium product id maps to PREMIUM", () => {
  process.env.POLAR_PRODUCT_ROMANCE_PREMIUM = "prod_romance_premium_test";
  try {
    assert.equal(
      getRomancePlanFromPolarProductId("prod_romance_premium_test"),
      "PREMIUM"
    );
  } finally {
    process.env = { ...ORIGINAL_ENV };
  }
});

test("a B2B product id never maps to a Romance plan, even when both are configured", () => {
  process.env.POLAR_PRODUCT_ROMANCE_PREMIUM = "prod_romance_premium_test";
  process.env.POLAR_PRODUCT_STARTER = "prod_starter_test";
  try {
    assert.equal(getRomancePlanFromPolarProductId("prod_starter_test"), null);
  } finally {
    process.env = { ...ORIGINAL_ENV };
  }
});

test("Romance status mapping: active/trialing collapse to ACTIVE", () => {
  assert.equal(mapPolarStatusToRomanceStatus("active"), "ACTIVE");
  assert.equal(mapPolarStatusToRomanceStatus("trialing"), "ACTIVE");
});

test("Romance status mapping: canceled/revoked collapse to CANCELED", () => {
  assert.equal(mapPolarStatusToRomanceStatus("canceled"), "CANCELED");
  assert.equal(mapPolarStatusToRomanceStatus("revoked"), "CANCELED");
});

test("Romance status mapping: fails closed - payment-troubled/ambiguous/unknown statuses are never ACTIVE", () => {
  assert.equal(mapPolarStatusToRomanceStatus("past_due"), "EXPIRED");
  assert.equal(mapPolarStatusToRomanceStatus("unpaid"), "EXPIRED");
  assert.equal(mapPolarStatusToRomanceStatus("paused"), "EXPIRED");
  assert.equal(mapPolarStatusToRomanceStatus("incomplete"), "EXPIRED");
  assert.equal(mapPolarStatusToRomanceStatus("incomplete_expired"), "EXPIRED");
  assert.equal(mapPolarStatusToRomanceStatus("some_future_status"), "EXPIRED");
  assert.equal(mapPolarStatusToRomanceStatus(undefined), "EXPIRED");
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
