import assert from "node:assert/strict";
import test from "node:test";

import { resolveTitleSubmission } from "../src/features/ai/lib/editable-title";

test("submits a trimmed, changed title", () => {
  const result = resolveTitleSubmission("  New title  ", "Old title");
  assert.deepEqual(result, { shouldSubmit: true, nextTitle: "New title" });
});

test("treats an empty draft as cancel, not a submission", () => {
  const result = resolveTitleSubmission("   ", "Old title");
  assert.deepEqual(result, { shouldSubmit: false });
});

test("treats an unchanged draft as cancel", () => {
  const result = resolveTitleSubmission("Same title", "Same title");
  assert.deepEqual(result, { shouldSubmit: false });
});

test("treats a draft that only differs by surrounding whitespace as unchanged", () => {
  const result = resolveTitleSubmission("  Same title  ", "Same title");
  assert.deepEqual(result, { shouldSubmit: false });
});

test("submits when only internal whitespace differs", () => {
  const result = resolveTitleSubmission("New  title", "New title");
  assert.deepEqual(result, { shouldSubmit: true, nextTitle: "New  title" });
});
