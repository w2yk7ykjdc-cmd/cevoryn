import "server-only";

import { parseFeed } from "./rss-parser";
import type { RawSignal, SignalAdapter, SignalAdapterContext } from "./types";

const FETCH_TIMEOUT_MS = 8_000;

export const rssAdapter: SignalAdapter = {
  name: "rss",

  async fetchSignals(context: SignalAdapterContext): Promise<RawSignal[]> {
    const feedUrl = context.metadata.rssUrl;
    if (typeof feedUrl !== "string" || !feedUrl.trim()) return [];

    try {
      const response = await fetch(feedUrl, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          Accept:
            "application/rss+xml, application/atom+xml, application/xml, text/xml",
        },
      });
      if (!response.ok) return [];

      const xml = await response.text();
      return parseFeed(xml);
    } catch (_error) {
      // Transport/timeout/parse failure for this one entity's feed - never
      // let a single dead feed fail the whole ingestion run.
      return [];
    }
  },
};
