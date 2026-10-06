import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveBeatTransitionEventType,
  evaluateBeatTransition,
} from "../src/features/romance/engine/beat-transition-math";
import type { BeatExitRule } from "../src/features/romance/engine/beat-transition-math";

test("ACCEPT_BARGAIN and BREAK_BARGAIN map to their sealed/broken event types, everything else maps to INTENT_RESOLVED", () => {
  assert.equal(deriveBeatTransitionEventType("ACCEPT_BARGAIN"), "BARGAIN_SEALED");
  assert.equal(deriveBeatTransitionEventType("BREAK_BARGAIN"), "BARGAIN_BROKEN");
  assert.equal(deriveBeatTransitionEventType("PROMISE"), "INTENT_RESOLVED");
  assert.equal(deriveBeatTransitionEventType("ASK_QUESTION"), "INTENT_RESOLVED");
});

test("a rule only fires once its minimum occurrence threshold is met", () => {
  const rules: BeatExitRule[] = [
    { onEventType: "INTENT_RESOLVED", next: "bargain", minOccurrencesInBeat: 2 },
  ];

  assert.equal(evaluateBeatTransition(rules, "INTENT_RESOLVED", 1), null);
  assert.deepEqual(evaluateBeatTransition(rules, "INTENT_RESOLVED", 2), {
    next: "bargain",
    completesSession: false,
  });
});

test("a rule with no minOccurrencesInBeat defaults to firing on the first occurrence", () => {
  const rules: BeatExitRule[] = [{ onEventType: "BARGAIN_SEALED", next: "first_choice" }];
  assert.deepEqual(evaluateBeatTransition(rules, "BARGAIN_SEALED", 1), {
    next: "first_choice",
    completesSession: false,
  });
});

test("an unrelated event type never matches a rule", () => {
  const rules: BeatExitRule[] = [{ onEventType: "BARGAIN_SEALED", next: "first_choice" }];
  assert.equal(evaluateBeatTransition(rules, "BARGAIN_BROKEN", 1), null);
});

test("completesSession is surfaced when the rule declares it", () => {
  const rules: BeatExitRule[] = [
    { onEventType: "INTENT_RESOLVED", next: null, minOccurrencesInBeat: 3, completesSession: true },
  ];
  assert.deepEqual(evaluateBeatTransition(rules, "INTENT_RESOLVED", 3), {
    next: null,
    completesSession: true,
  });
});

test("the first matching rule wins when multiple rules share an event type", () => {
  const rules: BeatExitRule[] = [
    { onEventType: "BARGAIN_SEALED", next: "early", minOccurrencesInBeat: 1 },
    { onEventType: "BARGAIN_SEALED", next: "late", minOccurrencesInBeat: 1 },
  ];
  assert.deepEqual(evaluateBeatTransition(rules, "BARGAIN_SEALED", 1), {
    next: "early",
    completesSession: false,
  });
});
