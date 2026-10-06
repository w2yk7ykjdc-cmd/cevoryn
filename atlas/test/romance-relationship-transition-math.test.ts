import assert from "node:assert/strict";
import test from "node:test";

import {
  applyRelationshipEvent,
  clamp,
} from "../src/features/romance/engine/relationship-transition-math";
import type { RelationshipDimensions } from "../src/features/romance/engine/types";

function baseline(): RelationshipDimensions {
  return { trust: 50, attraction: 50, fear: 50, loyalty: 50, tension: 50 };
}

test("clamp keeps values within [0, 100]", () => {
  assert.equal(clamp(-10), 0);
  assert.equal(clamp(150), 100);
  assert.equal(clamp(42), 42);
});

test("breaking a bargain decreases trust/loyalty and increases tension, each change traceable", () => {
  const { next, changes } = applyRelationshipEvent(baseline(), "BARGAIN_BROKEN");

  assert.equal(next.trust, 20);
  assert.equal(next.loyalty, 35);
  assert.equal(next.tension, 70);
  assert.equal(next.attraction, 50);
  assert.equal(next.fear, 50);

  assert.equal(changes.length, 3);
  const trustChange = changes.find((c) => c.dimension === "trust");
  assert.equal(trustChange?.previousValue, 50);
  assert.equal(trustChange?.newValue, 20);
  assert.equal(trustChange?.delta, -30);
  assert.equal(trustChange?.cause, "BARGAIN_BROKEN");
});

test("fulfilling a promise increases trust and loyalty", () => {
  const { next } = applyRelationshipEvent(baseline(), "PROMISE_FULFILLED");
  assert.equal(next.trust, 60);
  assert.equal(next.loyalty, 55);
});

test("changes clamp at the boundary instead of overshooting", () => {
  const nearMax: RelationshipDimensions = {
    trust: 95,
    attraction: 50,
    fear: 95,
    loyalty: 50,
    tension: 50,
  };
  const { next, changes } = applyRelationshipEvent(nearMax, "TRUE_NAME_REVEALED");

  assert.equal(next.trust, 100);
  assert.equal(next.fear, 100);

  const trustChange = changes.find((c) => c.dimension === "trust");
  assert.equal(trustChange?.delta, 5); // 95 -> 100, not the full +15
});

test("a cause with no configured delta for a dimension leaves it untouched and emits no change record for it", () => {
  const { next, changes } = applyRelationshipEvent(baseline(), "PROMISE_MADE");
  assert.deepEqual(next, baseline());
  assert.deepEqual(changes, []);
});
