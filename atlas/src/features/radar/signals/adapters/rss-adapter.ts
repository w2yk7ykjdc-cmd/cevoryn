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
      if (!response) throw new Error("RSS adapter request failed after retries");
      if (!response.ok) throw new Error(`RSS adapter returned HTTP ${response.status}`);

      const xml = await response.text();
      return parseFeed(xml);
    } catch (error) {
      // Ingestion catches this per adapter and persists it in the pipeline run.
      if (error instanceof UnsafeUrlError) {
        console.warn(`[cevoryn:radar] rss adapter: ${error.message}`);
      }
      throw error instanceof Error ? error : new Error("RSS feed request failed");
    }
  },
};
