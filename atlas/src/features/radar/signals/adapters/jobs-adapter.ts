import "server-only";

import { fetchWithRetry } from "./fetch-with-retry";
import type { RawSignal, SignalAdapter, SignalAdapterContext } from "./types";

const FETCH_TIMEOUT_MS = 8_000;
const MAX_ITEMS = 50;

interface GreenhouseJob {
  id: number;
  title: string;
  updated_at: string;
  absolute_url: string;
  location?: { name?: string };
}

interface GreenhouseBoardResponse {
  jobs?: GreenhouseJob[];
}

/**
 * Greenhouse's public job board API - free, no auth, no discovery: it only
 * works for entities where the user has supplied the company's Greenhouse
 * "board token" in ExternalEntity.metadata.greenhouseToken (there is no
 * general way to derive a company's ATS board token from its name/domain
 * alone). Absence of that key is a normal "not configured for this
 * entity", not an error - this is a known, documented MVP limitation
 * rather than an attempt at automatic discovery. An invalid token or
 * unknown board returns a 404 from Greenhouse, which resolves here to an
 * empty array (not retried - see fetchWithRetry's 4xx-vs-5xx distinction).
 */
export const jobsAdapter: SignalAdapter = {
  name: "jobs_greenhouse",

  async fetchSignals(context: SignalAdapterContext): Promise<RawSignal[]> {
    const token = context.metadata.greenhouseToken;
    if (typeof token !== "string" || !token.trim()) return [];

    const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs`;

    try {
      const response = await fetchWithRetry(url, {
        timeoutMs: FETCH_TIMEOUT_MS,
        headers: { Accept: "application/json" },
      });
      if (!response || !response.ok) return [];

      const data = (await response.json()) as GreenhouseBoardResponse;
      const jobs = data.jobs ?? [];

      return jobs.slice(0, MAX_ITEMS).map((job) => {
        const publishedAt = new Date(job.updated_at);
        return {
          source: "jobs_greenhouse",
          sourceType: "JOB_POSTING" as const,
          sourceUrl: job.absolute_url,
          title: job.title,
          rawContent: `Open position: ${job.title}${job.location?.name ? ` (${job.location.name})` : ""}.`,
          publishedAt: Number.isNaN(publishedAt.getTime()) ? null : publishedAt,
        };
      });
    } catch (_error) {
      return [];
    }
  },
};
