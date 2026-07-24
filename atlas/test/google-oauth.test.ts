import assert from "node:assert/strict";
import test from "node:test";

import { createOAuthState } from "../src/lib/google-oauth";

test("createOAuthState returns a strong random URL-safe value", () => {
  const first = createOAuthState();
  const second = createOAuthState();

  assert.match(first, /^[A-Za-z0-9_-]+$/);
  assert.ok(first.length >= 40);
  assert.notEqual(first, second);
});
