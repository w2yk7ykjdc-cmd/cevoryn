import assert from "node:assert/strict";
import test from "node:test";

import { excerptProprietaryContent } from "../src/features/enterprise/proprietary-data/content-excerpt";

test("returns content unchanged when at or under the default 500-char limit", () => {
  const short = "a".repeat(500);
  assert.equal(excerptProprietaryContent(short), short);
  assert.equal(excerptProprietaryContent("short content"), "short content");
});

test("truncates content over the default 500-char limit and appends an ellipsis", () => {
  const long = "x".repeat(1000);
  const result = excerptProprietaryContent(long);
  assert.equal(result.length, 501); // 500 chars + the ellipsis character
  assert.ok(result.startsWith("x".repeat(500)));
  assert.ok(result.endsWith("…"));
});

test("respects a custom maxLength", () => {
  const content = "0123456789";
  assert.equal(excerptProprietaryContent(content, 5), "01234…");
  assert.equal(excerptProprietaryContent(content, 10), content);
  assert.equal(excerptProprietaryContent(content, 20), content);
});
