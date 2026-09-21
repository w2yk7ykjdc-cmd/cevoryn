import assert from "node:assert/strict";
import test from "node:test";

import { buildNewsSearchQuery } from "../src/features/radar/signals/adapters/news-adapter";

test("builds an exact company-name news query", () => {
  assert.equal(
    buildNewsSearchQuery("Acme Inc.", null),
    '"Acme Inc."'
  );
});

test("adds the normalized domain when available", () => {
  assert.equal(
    buildNewsSearchQuery("Acme Inc.", "www.acme.example"),
    '"Acme Inc." OR "acme.example"'
  );
});

test("trims surrounding whitespace and returns empty for a blank name", () => {
  assert.equal(
    buildNewsSearchQuery("  Acme Inc.  ", "  www.acme.example "),
    '"Acme Inc." OR "acme.example"'
  );
  assert.equal(buildNewsSearchQuery("   ", null), "");
});

test("caps generated queries at the adapter limit", () => {
  const name = "A".repeat(300);
  const query = buildNewsSearchQuery(name, "example.com");
  assert.equal(query.length, 180);
});
