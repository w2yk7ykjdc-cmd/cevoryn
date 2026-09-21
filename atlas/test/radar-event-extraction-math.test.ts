import assert from "node:assert/strict";
import test from "node:test";

import { selectValidEvents } from "../src/features/radar/events/event-extraction-math";

function validEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: "HIRING_ACCELERATION",
    title: "Acme is rapidly hiring engineers",
    description: "Several new engineering job postings observed.",
    confidence: 0.7,
    signalIndexes: [0],
    occurredAt: "2026-01-15T00:00:00.000Z",
    ...overrides,
  };
}

test("returns no candidates for non-array input", () => {
  assert.deepEqual(selectValidEvents({ not: "an array" }, 5), []);
  assert.deepEqual(selectValidEvents(null, 5), []);
});

test("accepts a well-formed event", () => {
  const candidates = selectValidEvents([validEvent()], 3);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.type, "HIRING_ACCELERATION");
});

test("rejects an unrecognized event type", () => {
  const candidates = selectValidEvents(
    [validEvent({ type: "MADE_UP_TYPE" })],
    3
  );
  assert.deepEqual(candidates, []);
});

test("rejects a title shorter than the minimum length", () => {
  const candidates = selectValidEvents([validEvent({ title: "Hi" })], 3);
  assert.deepEqual(candidates, []);
});

test("rejects confidence outside 0-1", () => {
  assert.deepEqual(selectValidEvents([validEvent({ confidence: 1.5 })], 3), []);
  assert.deepEqual(selectValidEvents([validEvent({ confidence: -0.1 })], 3), []);
});

test("rejects an event with no signal indexes", () => {
  const candidates = selectValidEvents(
    [validEvent({ signalIndexes: [] })],
    3
  );
  assert.deepEqual(candidates, []);
});

test("drops a hallucinated signal index outside the batch, but keeps the event if at least one index is valid", () => {
  const candidates = selectValidEvents(
    [validEvent({ signalIndexes: [0, 99] })],
    3
  );
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0]?.signalIndexes, [0]);
});

test("rejects an event whose every signal index is out of range", () => {
  const candidates = selectValidEvents(
    [validEvent({ signalIndexes: [99, 100] })],
    3
  );
  assert.deepEqual(candidates, []);
});

test("falls back to now for an invalid occurredAt", () => {
  const candidates = selectValidEvents(
    [validEvent({ occurredAt: "not a date" })],
    3
  );
  assert.equal(candidates.length, 1);
  assert.ok(!Number.isNaN(Date.parse(candidates[0]?.occurredAt ?? "")));
});

test("accepts every valid event type", () => {
  const types = [
    "HIRING_ACCELERATION",
    "HIRING_DECLINE",
    "EXPANSION",
    "NEW_FACILITY",
    "LEADERSHIP_CHANGE",
    "FUNDING",
    "ACQUISITION",
    "PRODUCT_LAUNCH",
    "PARTNERSHIP",
    "PROCUREMENT",
    "MARKET_ENTRY",
    "REGULATORY_CHANGE",
  ];
  const candidates = selectValidEvents(
    types.map((type) => validEvent({ type })),
    3
  );
  assert.equal(candidates.length, types.length);
});


test("collapses duplicate event titles for the same event type", () => {
  const events = selectValidEvents(
    [
      {
        type: "EXPANSION",
        title: "Acme opens Berlin office",
        description: "First report",
        confidence: 0.8,
        signalIndexes: [0],
        occurredAt: "2026-01-15T00:00:00.000Z",
      },
      {
        type: "EXPANSION",
        title: "  acme opens   berlin office  ",
        description: "Second report",
        confidence: 0.9,
        signalIndexes: [1],
        occurredAt: "2026-01-16T00:00:00.000Z",
      },
    ],
    2
  );

  assert.equal(events.length, 1);
  assert.deepEqual(events[0]?.signalIndexes, [0]);
});

test("deduplicates signal indexes within an event", () => {
  const events = selectValidEvents(
    [
      {
        type: "FUNDING",
        title: "Acme raises Series B",
        description: "Funding announced",
        confidence: 0.9,
        signalIndexes: [0, 0, 1, 1],
        occurredAt: "2026-01-15T00:00:00.000Z",
      },
    ],
    2
  );

  assert.deepEqual(events[0]?.signalIndexes, [0, 1]);
});
