import assert from "node:assert/strict";
import test from "node:test";

import { evaluateSubscriptionIntegrity } from "../src/features/billing/subscription-integrity";
import type { OrganizationSubscription } from "../src/features/billing/types";

function buildSubscription(
  overrides: Partial<OrganizationSubscription> = {}
): OrganizationSubscription {
  return {
    id: "sub_1",
    organizationId: "org_1",
    stripeCustomerId: "paddle:ctm_123",
    stripeSubscriptionId: null,
    stripePriceId: null,
    paddleCustomerId: "ctm_123",
    paddleSubscriptionId: "sub_paddle_123",
    paddlePriceId: "pri_123",
    plan: "PROFESSIONAL",
    subscriptionStatus: "ACTIVE",
    currentPeriodStart: new Date("2026-01-01"),
    currentPeriodEnd: new Date("2026-02-01"),
    cancelAtPeriodEnd: false,
    trialEnd: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

test("a subscription written by the Paddle webhook has no anomalies", () => {
  const result = evaluateSubscriptionIntegrity(buildSubscription());
  assert.equal(result.originatedFromPaddleWebhook, true);
  assert.deepEqual(result.anomalies, []);
});

test("flags a stripe_customer_id that doesn't follow the paddle: convention", () => {
  const result = evaluateSubscriptionIntegrity(
    buildSubscription({ stripeCustomerId: "cus_legacy_stripe_id" })
  );
  assert.equal(result.originatedFromPaddleWebhook, false);
  assert.equal(result.anomalies.length, 1);
  assert.match(
    result.anomalies.at(0) ?? "",
    /does not match the "paddle:<id>" convention/
  );
});

test("flags an active subscription missing paddle_subscription_id", () => {
  const result = evaluateSubscriptionIntegrity(
    buildSubscription({ paddleSubscriptionId: null })
  );
  assert.equal(
    result.anomalies.some((message) =>
      message.includes("paddle_subscription_id is null")
    ),
    true
  );
});

test("flags a trialing subscription missing paddle_customer_id", () => {
  const result = evaluateSubscriptionIntegrity(
    buildSubscription({
      subscriptionStatus: "TRIALING",
      paddleCustomerId: null,
    })
  );
  assert.equal(
    result.anomalies.some((message) =>
      message.includes("paddle_customer_id is null")
    ),
    true
  );
});

test("a canceled subscription with no paddle ids is not anomalous", () => {
  const result = evaluateSubscriptionIntegrity(
    buildSubscription({
      subscriptionStatus: "CANCELED",
      paddleSubscriptionId: null,
      paddleCustomerId: null,
    })
  );
  assert.deepEqual(result.anomalies, []);
});
