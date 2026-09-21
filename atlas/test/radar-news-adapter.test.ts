import assert from "node:assert/strict";
import test from "node:test";

import { buildNewsSearchQuery } from "../src/features/radar/signals/adapters/news-query";

test("builds an exact company-name news query", () => {
  assert.equal(buildNewsSearchQuery("Acme Inc.", null), '"Acme Inc."');
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

import { filterRelevantNewsSignals } from "../src/features/radar/signals/adapters/news-relevance";
import type { RawSignal } from "../src/features/radar/signals/adapters/types";

function news(title: string, rawContent = title): RawSignal {
  return {
    source: "google_news",
    sourceType: "NEWS_ARTICLE",
    sourceUrl: "https://news.example/article",
    title,
    rawContent,
    publishedAt: null,
  };
}

test("rejects a short single-token company name without company context", () => {
  assert.equal(
    filterRelevantNewsSignals([news("Apple launches new iPhone")], {
      entityName: "Apple",
      entityDomain: null,
      industry: null,
      country: null,
    }).length,
    0
  );
});

test("keeps a short company name when industry context is present", () => {
  assert.equal(
    filterRelevantNewsSignals([news("Apple reports record revenue", "Apple reports record revenue in the technology sector")], {
      entityName: "Apple",
      entityDomain: null,
      industry: "technology",
      country: null,
    }).length,
    1
  );
});

test("keeps a company when its domain appears in the article evidence", () => {
  assert.equal(
    filterRelevantNewsSignals([news("Acme expands", "Acme expands operations; acme.example")], {
      entityName: "Acme",
      entityDomain: "www.acme.example",
      industry: null,
      country: null,
    }).length,
    1
  );
});

test("rejects an unrelated article even when the company has a domain", () => {
  assert.equal(
    filterRelevantNewsSignals([news("Acme competitor raises funding", "A different company raises funding")], {
      entityName: "Acme",
      entityDomain: "acme.example",
      industry: "software",
      country: "US",
    }).length,
    0
  );
});
