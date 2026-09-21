import "server-only";

import { fetchWithRetry } from "./fetch-with-retry";
import { filterRelevantNewsSignals } from "./news-relevance";
import { parseFeed } from "./rss-parser";
import { buildNewsSearchQuery } from "./news-query";
import type { RawSignal, SignalAdapter, SignalAdapterContext } from "./types";

const FETCH_TIMEOUT_MS = 8_000;

/**
 * Keyless external-news discovery for watched companies.
 *
 * Google News exposes an RSS search endpoint, allowing Radar to discover
 * company-specific news without requiring each customer to configure a feed.
 * Results remain untrusted external evidence and enter the existing
 * Signal -> Event -> Opportunity pipeline.
 */
export const newsAdapter: SignalAdapter = {
  name: "news",

  async fetchSignals(context: SignalAdapterContext): Promise<RawSignal[]> {
    const query = buildNewsSearchQuery(
      context.entityName,
      context.entityDomain
    );
    if (!query) return [];

    const url =
      `https://news.google.com/rss/search?q=${encodeURIComponent(query)}` +
      "&hl=en-US&gl=US&ceid=US:en";

    try {
      const response = await fetchWithRetry(url, {
        timeoutMs: FETCH_TIMEOUT_MS,
        headers: {
          Accept: "application/rss+xml, application/xml, text/xml",
        },
      });
      if (!response || !response.ok) return [];

      const xml = await response.text();
      const signals = parseFeed(xml);

      return filterRelevantNewsSignals(signals, {
        entityName: context.entityName,
        entityDomain: context.entityDomain,
        industry: context.entityIndustry,
        country: context.entityCountry,
      })).map((signal) => ({
        ...signal,
        source: "google_news",
        sourceType: "NEWS_ARTICLE" as const,
      }));
    } catch (_error) {
      return [];
    }
  },
};
