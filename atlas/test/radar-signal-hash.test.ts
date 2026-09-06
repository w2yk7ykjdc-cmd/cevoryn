import assert from "node:assert/strict";
import test from "node:test";

import { hashSignal } from "../src/features/radar/signals/signal-hash";

test("is deterministic for the same inputs", () => {
  const a = hashSignal("rss", "https://example.com/post", "Title");
  const b = hashSignal("rss", "https://example.com/post", "Title");
  assert.equal(a, b);
});

test("differs when source, url, or title differ", () => {
  const base = hashSignal("rss", "https://example.com/post", "Title");
  assert.notEqual(base, hashSignal("jobs_greenhouse", "https://example.com/post", "Title"));
  assert.notEqual(base, hashSignal("rss", "https://example.com/other", "Title"));
  assert.notEqual(base, hashSignal("rss", "https://example.com/post", "Other title"));
});

test("produces a hex sha256 digest", () => {
  const hash = hashSignal("rss", "https://example.com/post", "Title");
  assert.match(hash, /^[0-9a-f]{64}$/);
});
