import assert from "node:assert/strict";
import test from "node:test";

import { canSubmitStoryAction } from "../src/features/romance/sessions/story-submission-guard";

function baseState() {
  return {
    rawInput: "I step closer.",
    isPending: false,
    sessionCompleted: false,
    isSubmitting: false,
  };
}

test("a trimmed, non-empty input with no in-flight state is submittable", () => {
  assert.equal(canSubmitStoryAction(baseState()), true);
});

test("whitespace-only input is never submittable", () => {
  assert.equal(
    canSubmitStoryAction({ ...baseState(), rawInput: "   " }),
    false
  );
});

test("empty input is never submittable", () => {
  assert.equal(canSubmitStoryAction({ ...baseState(), rawInput: "" }), false);
});

test("a request already pending (post-commit) blocks a second submission", () => {
  assert.equal(
    canSubmitStoryAction({ ...baseState(), isPending: true }),
    false
  );
});

test("a completed session blocks further submissions", () => {
  assert.equal(
    canSubmitStoryAction({ ...baseState(), sessionCompleted: true }),
    false
  );
});

test("regression: a second tap firing before the isPending state commits is still blocked via the synchronous isSubmitting flag", () => {
  // This is the exact race the ref guard exists for: isPending is still
  // false (React hasn't re-rendered yet) but isSubmitting was already set
  // synchronously by the first tap's handler.
  assert.equal(
    canSubmitStoryAction({
      ...baseState(),
      isPending: false,
      isSubmitting: true,
    }),
    false
  );
});
