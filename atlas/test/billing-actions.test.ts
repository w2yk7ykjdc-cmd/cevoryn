/**
 * Pure-logic coverage for billing-actions.tsx's formatting and Paddle
 * error-mapping helpers — the currency/quota display strings and the
 * error-code-to-message mapping shown when a Paddle checkout fails.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  formatMemberLimit,
  formatPlanPrice,
  formatTokenLimit,
  getPaddleErrorMessage,
} from "../src/features/billing/components/billing-actions";

function fakeTranslatorFn(key: string, params?: Record<string, unknown>) {
  return params ? `${key}:${JSON.stringify(params)}` : key;
}

// The real translator type carries next-intl's rich/markup/raw/has helpers
// that this test never calls — a plain (key, params) => string stand-in is
// all `formatMemberLimit`/`formatTokenLimit`/`getPaddleErrorMessage` actually
// use. Cast per call site since the two namespaces ("billing"/"pricing")
// are structurally distinct translator types.
const fakePricingTranslator = fakeTranslatorFn as unknown as Parameters<
  typeof formatMemberLimit
>[1];
const fakeBillingTranslator = fakeTranslatorFn as unknown as Parameters<
  typeof formatTokenLimit
>[1];

test("formatPlanPrice renders whole-dollar amounts without decimals", () => {
  const result = formatPlanPrice({
    amount: 49,
    currencyCode: "USD",
    interval: "month",
  });
  assert.equal(result, "$49/month");
});

test("formatPlanPrice keeps decimals for fractional amounts", () => {
  const result = formatPlanPrice({
    amount: 49.99,
    currencyCode: "USD",
    interval: "month",
  });
  assert.equal(result, "$49.99/month");
});

test("formatMemberLimit uses the singular key for a limit of exactly one", () => {
  const result = formatMemberLimit(1, fakePricingTranslator);
  assert.equal(result, "memberLimitOne");
});

test("formatMemberLimit uses the plural key with a count for more than one", () => {
  const result = formatMemberLimit(5, fakePricingTranslator);
  assert.equal(result, 'memberLimit:{"count":5}');
});

test("formatTokenLimit renders whole millions without a decimal", () => {
  const result = formatTokenLimit(2_000_000, fakeBillingTranslator);
  assert.equal(result, 'tokenLimitMillions:{"count":2}');
});

test("formatTokenLimit keeps one decimal for fractional millions", () => {
  const result = formatTokenLimit(1_500_000, fakeBillingTranslator);
  assert.equal(result, 'tokenLimitMillions:{"count":"1.5"}');
});

test("formatTokenLimit falls back to thousands below one million", () => {
  const result = formatTokenLimit(250_000, fakeBillingTranslator);
  assert.equal(result, 'tokenLimitThousands:{"count":250}');
});

test("getPaddleErrorMessage maps the checkout-url-not-set code to a friendly message", () => {
  const result = getPaddleErrorMessage(
    { code: "transaction_default_checkout_url_not_set" },
    fakeBillingTranslator
  );
  assert.equal(result, "paddleLinkNotConfigured");
});

test("getPaddleErrorMessage maps the invalid-token code to a friendly message", () => {
  const result = getPaddleErrorMessage(
    { error: { code: "invalid_client_token" } },
    fakeBillingTranslator
  );
  assert.equal(result, "paddleInvalidToken");
});

test("getPaddleErrorMessage prefers the raw detail text when present", () => {
  const result = getPaddleErrorMessage(
    { code: "some_other_code", detail: "Card declined" },
    fakeBillingTranslator
  );
  assert.equal(result, "Card declined");
});

test("getPaddleErrorMessage falls back to a generic message keyed by code", () => {
  const result = getPaddleErrorMessage(
    { code: "some_other_code" },
    fakeBillingTranslator
  );
  assert.equal(result, 'paddleCheckoutError:{"code":"some_other_code"}');
});

test("getPaddleErrorMessage returns null when there is no code or detail", () => {
  const result = getPaddleErrorMessage({}, fakeBillingTranslator);
  assert.equal(result, null);
});
