import assert from "node:assert/strict";
import test from "node:test";

import { selectValidMemories } from "../src/features/brain/memory/memory-extraction-math";

test("returns no candidates for a non-array input", () => {
  assert.deepEqual(selectValidMemories({ not: "an array" }), []);
  assert.deepEqual(selectValidMemories(null), []);
  assert.deepEqual(selectValidMemories(undefined), []);
});

test("accepts a well-formed memory", () => {
  const candidates = selectValidMemories([
    { category: "DECISION", content: "Team decided to use PostgreSQL." },
  ]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.category, "DECISION");
  assert.equal(candidates[0]?.content, "Team decided to use PostgreSQL.");
});

test("accepts every valid memory category", () => {
  const categories = [
    "DECISION",
    "PREFERENCE",
    "TEAM_DYNAMIC",
    "PROJECT_STATUS",
    "PROCESS",
    "GOAL",
    "FACT",
  ];
  const candidates = selectValidMemories(
    categories.map((category) => ({
      category,
      content: `A fact about ${category}`,
    }))
  );
  assert.equal(candidates.length, categories.length);
});

test("drops items with an unrecognized category", () => {
  const candidates = selectValidMemories([
    { category: "OPINION", content: "This is a long enough opinion." },
  ]);
  assert.deepEqual(candidates, []);
});

test("drops items with content shorter than 5 characters", () => {
  const candidates = selectValidMemories([
    { category: "FACT", content: "abcd" },
  ]);
  assert.deepEqual(candidates, []);
});

test("keeps content exactly 5 characters long", () => {
  const candidates = selectValidMemories([
    { category: "FACT", content: "abcde" },
  ]);
  assert.equal(candidates.length, 1);
});

test("drops items with a non-string content field", () => {
  const candidates = selectValidMemories([
    { category: "FACT", content: 12345 },
    { category: "FACT" },
  ]);
  assert.deepEqual(candidates, []);
});

test("drops items with a non-string category field", () => {
  const candidates = selectValidMemories([
    { category: 42, content: "Some valid content here." },
  ]);
  assert.deepEqual(candidates, []);
});
