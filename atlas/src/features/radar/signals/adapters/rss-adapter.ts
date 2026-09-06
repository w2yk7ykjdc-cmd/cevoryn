import "server-only";

import { fetchWithRetry, UnsafeUrlError } from "./fetch-with-retry";
import { parseFeed } from "./rss-parser";
import type { RawSignal, SignalAdapter, SignalAdapterContext } from "./types";

const FETCH_TIMEOUT_MS = 8_000;

export const rssAdapter: SignalAdapter = {
  name: "rss",

  async fetchSignals(context: SignalAdapterContext): Promise<RawSignal[]> {
    const feedUrl = context.metadata.rssUrl;
    if (typeof feedUrl !== "string" || !feedUrl.trim()) return [];

    try {
      const response = await fetchWithRetry(feedUrl, {
        timeoutMs: FETCH_TIMEOUT_MS,
        headers: {
          Accept:
            "application/rss+xml, application/atom+xml, application/xml, text/xml",
        },
      });
      if (!response || !response.ok) return [];

      const xml = await response.text();
      return parseFeed(xml);
    } catch (error) {
      // Transport/timeout/parse failure - or a rejected unsafe URL - for
      // this one entity's feed. Never let a single misconfigured or dead
      // feed fail the whole ingestion run.
      if (error instanceof UnsafeUrlError) {
        console.warn(`[cevoryn:radar] rss adapter: ${error.message}`);
      }
      return [];
    }
  },
};
