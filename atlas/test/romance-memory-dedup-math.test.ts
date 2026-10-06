import assert from "node:assert/strict";
import test from "node:test";

import { resolveMemoryWrite } from "../src/features/romance/engine/memory-dedup-math";
import type { MemoryLite } from "../src/features/romance/engine/types";

function existing(overrides: Partial<MemoryLite> = {}): MemoryLite {
  return {
    id: "mem-1",
    type: "PROMISE",
    subject: "player",
    object: "caelan",
    content: "promised to return before moonrise",
    status: "ACTIVE",
    ...overrides,
  };
}

test("an identical retry of the same fact is skipped as a duplicate, not re-created", () => {
  // Simulates a retried write (e.g. after a timeout) resending the exact
  // same system-generated content, differing only in incidental
  // whitespace/case - not a human re-typing the same idea differently.
  const decision = resolveMemoryWrite([existing()], {
    type: "PROMISE",
    subject: "player",
    object: "caelan",
    content: "  Promised To Return Before Moonrise  ",
  });

  assert.deepEqual(decision, { action: "SKIP_DUPLICATE", existingId: "mem-1" });
});

test("a contradictory fact with the same signature supersedes the old one, not appended alongside it", () => {
  const decision = resolveMemoryWrite([existing()], {
    type: "PROMISE",
    subject: "player",
    object: "caelan",
    content: "promised to return before dawn",
  });

  assert.deepEqual(decision, { action: "SUPERSEDE", supersedesId: "mem-1" });
});

test("a superseded (non-ACTIVE) memory with the same signature does not block a new write", () => {
  const decision = resolveMemoryWrite(
    [existing({ status: "SUPERSEDED" })],
    {
      type: "PROMISE",
      subject: "player",
      object: "caelan",
      content: "promised to return before moonrise",
    }
  );

  assert.deepEqual(decision, { action: "CREATE" });
});

test("a different subject/object signature is always a new memory", () => {
  const decision = resolveMemoryWrite([existing()], {
    type: "PROMISE",
    subject: "player",
    object: "rival",
    content: "promised to return before moonrise",
  });

  assert.deepEqual(decision, { action: "CREATE" });
});

test("no existing memories always creates", () => {
  assert.deepEqual(
    resolveMemoryWrite([], {
      type: "SECRET",
      subject: "caelan",
      object: null,
      content: "his true name",
    }),
    { action: "CREATE" }
  );
});
