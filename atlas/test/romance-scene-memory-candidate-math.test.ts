import assert from "node:assert/strict";
import test from "node:test";

import { selectValidSceneMemoryCandidates } from "../src/features/romance/engine/scene-memory-candidate-math";

test("a non-array input yields no candidates", () => {
  assert.deepEqual(selectValidSceneMemoryCandidates(null), []);
  assert.deepEqual(selectValidSceneMemoryCandidates("not an array"), []);
  assert.deepEqual(selectValidSceneMemoryCandidates({ not: "an array" }), []);
});

test("a well-formed candidate is accepted", () => {
  const result = selectValidSceneMemoryCandidates([
    { type: "CHARACTER_FACT", subject: "caelan", object: null, content: "prefers silence to lies" },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.type, "CHARACTER_FACT");
});

test("an unrecognized memory type is dropped, never trusted blindly", () => {
  const result = selectValidSceneMemoryCandidates([
    { type: "MADE_UP_TYPE", subject: "caelan", content: "something" },
  ]);
  assert.deepEqual(result, []);
});

test("content that is too short or too long is dropped", () => {
  const result = selectValidSceneMemoryCandidates([
    { type: "WORLD_EVENT", subject: "court", content: "ok" },
    { type: "WORLD_EVENT", subject: "court", content: "x".repeat(501) },
  ]);
  assert.deepEqual(result, []);
});

test("a missing subject is dropped", () => {
  const result = selectValidSceneMemoryCandidates([
    { type: "WORLD_EVENT", content: "the court is in mourning" },
  ]);
  assert.deepEqual(result, []);
});

test("object defaults to null when absent or not a string", () => {
  const result = selectValidSceneMemoryCandidates([
    { type: "SECRET", subject: "caelan", content: "hides his binding" },
  ]);
  assert.equal(result[0]?.object, null);
});
