import assert from "node:assert/strict";
import test from "node:test";

import { parseFeed } from "../src/features/radar/signals/adapters/rss-parser";

const RSS_FEED = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Acme Blog</title>
  <item>
    <title>Acme opens new Berlin office</title>
    <link>https://acme.example/blog/berlin-office</link>
    <pubDate>Mon, 15 Jan 2026 10:00:00 GMT</pubDate>
    <description>Acme announced today it is opening a new office in Berlin.</description>
  </item>
  <item>
    <title><![CDATA[Acme raises Series B]]></title>
    <link>https://acme.example/blog/series-b</link>
    <pubDate>Tue, 16 Jan 2026 10:00:00 GMT</pubDate>
    <description><![CDATA[Acme raised $20M in Series B funding.]]></description>
  </item>
</channel></rss>`;

const ATOM_FEED = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Acme launches new product</title>
    <link href="https://acme.example/atom/new-product" />
    <updated>2026-01-17T10:00:00Z</updated>
    <summary>Acme launched a new product today.</summary>
  </entry>
</feed>`;

test("parses standard RSS 2.0 items", () => {
  const signals = parseFeed(RSS_FEED);
  assert.equal(signals.length, 2);
  assert.equal(signals[0]?.title, "Acme opens new Berlin office");
  assert.equal(signals[0]?.sourceUrl, "https://acme.example/blog/berlin-office");
  assert.equal(signals[0]?.sourceType, "PRESS_RELEASE");
  assert.ok(signals[0]?.publishedAt instanceof Date);
});

test("decodes CDATA sections", () => {
  const signals = parseFeed(RSS_FEED);
  assert.equal(signals[1]?.title, "Acme raises Series B");
  assert.equal(signals[1]?.rawContent, "Acme raised $20M in Series B funding.");
});

test("parses Atom entries via the href-based link element", () => {
  const signals = parseFeed(ATOM_FEED);
  assert.equal(signals.length, 1);
  assert.equal(signals[0]?.sourceUrl, "https://acme.example/atom/new-product");
  assert.equal(signals[0]?.title, "Acme launches new product");
});

test("skips items missing a title or link rather than throwing", () => {
  const malformed = `<rss><channel><item><description>No title or link</description></item></channel></rss>`;
  assert.deepEqual(parseFeed(malformed), []);
});

test("returns an empty array for non-feed content", () => {
  assert.deepEqual(parseFeed("<html><body>Not a feed</body></html>"), []);
  assert.deepEqual(parseFeed(""), []);
});

test("does not double-decode a double-encoded entity into a live special character", () => {
  // "&amp;quot;" is itself a literally-double-encoded form of a quote
  // character (someone encoded " as &quot;, then encoded that result
  // again). Decoding &amp; before &quot; would fully resolve this to a
  // live " in one pass (CodeQL js/double-escaping); decoding &amp; last
  // must leave it as the literal, still-escaped text "&quot;" instead.
  const feed = `<rss><channel><item><title>Say &amp;quot;hi&amp;quot;</title><link>https://example.com/a</link></item></channel></rss>`;
  const signals = parseFeed(feed);
  assert.equal(signals[0]?.title, 'Say &quot;hi&quot;');
});

test("still fully decodes a normal (single-encoded) entity", () => {
  const feed = `<rss><channel><item><title>Fish &amp; Chips</title><link>https://example.com/b</link></item></channel></rss>`;
  const signals = parseFeed(feed);
  assert.equal(signals[0]?.title, "Fish & Chips");
});

test("caps output at 20 items", () => {
  const items = Array.from(
    { length: 30 },
    (_, i) =>
      `<item><title>Item ${i}</title><link>https://example.com/${i}</link></item>`
  ).join("");
  const signals = parseFeed(`<rss><channel>${items}</channel></rss>`);
  assert.equal(signals.length, 20);
});
