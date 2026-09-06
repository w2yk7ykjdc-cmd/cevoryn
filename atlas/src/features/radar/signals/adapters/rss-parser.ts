import type { RawSignal } from "./types";

const MAX_ITEMS = 20;

/**
 * Pure RSS 2.0 / Atom parsing, split out of rss-adapter.ts (which imports
 * "server-only") so this stays importable from plain Node test files.
 * Deliberately not a full XML parser (no new dependency) - it extracts
 * only the handful of elements Radar needs via regex over each
 * <item>/<entry> block, sufficient for well-formed feeds and degrading to
 * "skip this item" rather than throwing on anything it can't parse.
 */
function decodeEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTag(block: string, tag: string): string | null {
  const match = block.match(
    new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i")
  );
  const captured = match?.[1];
  return captured !== undefined ? decodeEntities(captured) : null;
}

function extractAtomLink(block: string): string | null {
  const match = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
  return match?.[1] ?? null;
}

export function parseFeed(xml: string): RawSignal[] {
  const items: RawSignal[] = [];

  const rssItems = xml.match(/<item[^>]*>[\s\S]*?<\/item>/gi) ?? [];
  const atomEntries = xml.match(/<entry[^>]*>[\s\S]*?<\/entry>/gi) ?? [];

  for (const block of [...rssItems, ...atomEntries].slice(0, MAX_ITEMS)) {
    const title = extractTag(block, "title");
    const link = extractTag(block, "link") ?? extractAtomLink(block);
    const description =
      extractTag(block, "description") ??
      extractTag(block, "summary") ??
      extractTag(block, "content") ??
      "";
    const dateText =
      extractTag(block, "pubDate") ?? extractTag(block, "updated");
    const publishedAt = dateText ? new Date(dateText) : null;

    if (!title || !link) continue;

    items.push({
      source: "rss",
      sourceType: "PRESS_RELEASE",
      sourceUrl: link,
      title,
      rawContent: description || title,
      publishedAt:
        publishedAt && !Number.isNaN(publishedAt.getTime())
          ? publishedAt
          : null,
    });
  }

  return items;
}
