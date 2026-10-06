import assert from "node:assert/strict";
import test from "node:test";

import {
  canTransitionBargain,
  canTransitionDebt,
  canTransitionPromise,
} from "../src/features/romance/engine/commitment-fsm-math";

test("a bargain must be SEALED before it can be FULFILLED or BROKEN (FAE-002/FAE-005)", () => {
  assert.equal(canTransitionBargain("PROPOSED", "SEALED"), true);
  assert.equal(canTransitionBargain("SEALED", "FULFILLED"), true);
  assert.equal(canTransitionBargain("SEALED", "BROKEN"), true);

  // Cannot skip straight from PROPOSED to FULFILLED/BROKEN.
  assert.equal(canTransitionBargain("PROPOSED", "FULFILLED"), false);
  assert.equal(canTransitionBargain("PROPOSED", "BROKEN"), false);
});

test("a bargain already FULFILLED or BROKEN is terminal", () => {
  assert.equal(canTransitionBargain("FULFILLED", "BROKEN"), false);
  assert.equal(canTransitionBargain("BROKEN", "FULFILLED"), false);
});

test("a promise can be forgiven after being broken, but a fulfilled promise cannot be broken", () => {
  assert.equal(canTransitionPromise("MADE", "BROKEN"), true);
  assert.equal(canTransitionPromise("BROKEN", "FORGIVEN"), true);
  assert.equal(canTransitionPromise("FULFILLED", "BROKEN"), false);
});

test("a debt can escalate from OPEN and still be repaid or forgiven after escalating", () => {
  assert.equal(canTransitionDebt("OPEN", "ESCALATED"), true);
  assert.equal(canTransitionDebt("ESCALATED", "REPAID"), true);
  assert.equal(canTransitionDebt("ESCALATED", "FORGIVEN"), true);
  assert.equal(canTransitionDebt("REPAID", "ESCALATED"), false);
});
