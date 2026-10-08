import assert from "node:assert/strict";
import test from "node:test";

import { isRomancePremiumActive } from "../src/features/romance/billing/entitlement-math";

test("no subscription row at all (never subscribed) is never premium", () => {
  assert.equal(isRomancePremiumActive(null), false);
});

test("a FREE plan is never premium regardless of status", () => {
  assert.equal(
    isRomancePremiumActive({ plan: "FREE", status: "ACTIVE", currentPeriodEnd: null }),
    false
  );
});

test("a PREMIUM plan with ACTIVE status and no period end is premium", () => {
  assert.equal(
    isRomancePremiumActive({ plan: "PREMIUM", status: "ACTIVE", currentPeriodEnd: null }),
    true
  );
});

test("a PREMIUM plan with ACTIVE status is premium until its current period end passes", () => {
  const now = new Date("2026-06-15T00:00:00Z");
  const notYetEnded = new Date("2026-06-20T00:00:00Z");
  const alreadyEnded = new Date("2026-06-10T00:00:00Z");

  assert.equal(
    isRomancePremiumActive(
      { plan: "PREMIUM", status: "ACTIVE", currentPeriodEnd: notYetEnded },
      now
    ),
    true,
    "a canceled-but-still-paid-through-period-end subscription stays entitled"
  );
  assert.equal(
    isRomancePremiumActive(
      { plan: "PREMIUM", status: "ACTIVE", currentPeriodEnd: alreadyEnded },
      now
    ),
    false,
    "a PREMIUM row whose period has actually ended is never entitled, even if still marked ACTIVE"
  );
});

test("a PREMIUM plan with CANCELED or EXPIRED status is never premium, even with a future period end", () => {
  const futurePeriodEnd = new Date("2099-01-01T00:00:00Z");
  assert.equal(
    isRomancePremiumActive({ plan: "PREMIUM", status: "CANCELED", currentPeriodEnd: futurePeriodEnd }),
    false
  );
  assert.equal(
    isRomancePremiumActive({ plan: "PREMIUM", status: "EXPIRED", currentPeriodEnd: futurePeriodEnd }),
    false
  );
});
