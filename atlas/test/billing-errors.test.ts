import assert from "node:assert/strict";
import test from "node:test";

import { isMissingBillingTableError } from "../src/server/services/billing-errors";

// Every error shape below was captured from a real local Postgres +
// Prisma client (dropping the table/column and catching the thrown
// error), not guessed - see the comment in billing-errors.ts.

test("generated client: table missing (P2021) is treated as missing-table", () => {
  const error = {
    code: "P2021",
    meta: { modelName: "Subscription", table: "public.subscriptions" },
    message:
      "The table `public.subscriptions` does not exist in the current database.",
  };
  assert.equal(isMissingBillingTableError(error), true);
});

test("raw query: table missing (42P01 in meta.code) is treated as missing-table", () => {
  const error = {
    code: "P2010",
    meta: { code: "42P01", message: 'relation "subscriptions" does not exist' },
    message:
      'Raw query failed. Code: `42P01`. Message: `relation "subscriptions" does not exist`',
  };
  assert.equal(isMissingBillingTableError(error), true);
});

test("regression: generated client column missing (P2022) is NOT treated as missing-table", () => {
  // This is the real production bug: a migration that adds a column was
  // never applied to the database. The old broad "does not exist in the
  // current database" substring check also matched this message and
  // silently hid the error behind "no subscription yet" instead of
  // surfacing a real schema-drift bug loudly.
  const error = {
    code: "P2022",
    meta: {
      modelName: "Subscription",
      column: "subscriptions.polar_customer_id",
    },
    message:
      "The column `subscriptions.polar_customer_id` does not exist in the current database.",
  };
  assert.equal(isMissingBillingTableError(error), false);
});

test("regression: raw query column missing (42703 in meta.code) is NOT treated as missing-table", () => {
  const error = {
    code: "P2010",
    meta: {
      code: "42703",
      message:
        'column "polar_customer_id" of relation "subscriptions" does not exist',
    },
    message:
      'Raw query failed. Code: `42703`. Message: `column "polar_customer_id" of relation "subscriptions" does not exist`',
  };
  assert.equal(isMissingBillingTableError(error), false);
});

test("an unrelated error is not treated as missing-table", () => {
  assert.equal(isMissingBillingTableError(new Error("network timeout")), false);
});

test("a non-object error value never throws", () => {
  assert.equal(isMissingBillingTableError("string error"), false);
  assert.equal(isMissingBillingTableError(null), false);
  assert.equal(isMissingBillingTableError(undefined), false);
});
