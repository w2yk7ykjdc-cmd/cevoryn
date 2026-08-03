import assert from "node:assert/strict";
import test from "node:test";

import { selectActionCandidates } from "../src/features/brain/actions/action-preparation-math";

test("returns no candidates for a non-array input", () => {
  assert.deepEqual(selectActionCandidates({ not: "an array" }), []);
  assert.deepEqual(selectActionCandidates(null), []);
  assert.deepEqual(selectActionCandidates("EMAIL_DRAFT"), []);
});

test("accepts a well-formed action", () => {
  const candidates = selectActionCandidates([
    {
      type: "EMAIL_DRAFT",
      title: "Follow up with client",
      description: "Send a recap email",
      content: { to: "client@example.com" },
    },
  ]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.type, "EMAIL_DRAFT");
  assert.equal(candidates[0]?.title, "Follow up with client");
  assert.deepEqual(candidates[0]?.content, { to: "client@example.com" });
});

test("drops actions with a missing or blank title", () => {
  const candidates = selectActionCandidates([
    { type: "TASK", title: "", description: "", content: {} },
    { type: "TASK", title: "   ", description: "", content: {} },
    { type: "TASK", description: "", content: {} },
  ]);
  assert.deepEqual(candidates, []);
});

test("drops actions with an unrecognized type", () => {
  const candidates = selectActionCandidates([
    { type: "SEND_CARRIER_PIGEON", title: "Notify HQ", description: "", content: {} },
  ]);
  assert.deepEqual(candidates, []);
});

test("trims whitespace from the title", () => {
  const candidates = selectActionCandidates([
    { type: "TASK", title: "  Draft report  ", description: "", content: {} },
  ]);
  assert.equal(candidates[0]?.title, "Draft report");
});

test("defaults a missing description and content", () => {
  const candidates = selectActionCandidates([
    { type: "TASK", title: "Draft report" },
  ]);
  assert.equal(candidates[0]?.description, "");
  assert.deepEqual(candidates[0]?.content, {});
});

test("caps at 3 candidates even when more are proposed", () => {
  const raw = Array.from({ length: 5 }, (_, i) => ({
    type: "TASK",
    title: `Task ${i}`,
    description: "",
    content: {},
  }));
  const candidates = selectActionCandidates(raw);
  assert.equal(candidates.length, 3);
});

test("dedupes actions with the same type and title (case-insensitive)", () => {
  const candidates = selectActionCandidates([
    { type: "TASK", title: "Send invoice", description: "first", content: {} },
    { type: "TASK", title: "SEND INVOICE", description: "duplicate", content: {} },
  ]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.description, "first");
});

test("does not dedupe the same title across different types", () => {
  const candidates = selectActionCandidates([
    { type: "TASK", title: "Send invoice", description: "", content: {} },
    { type: "EMAIL_DRAFT", title: "Send invoice", description: "", content: {} },
  ]);
  assert.equal(candidates.length, 2);
});
