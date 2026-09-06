import "server-only";

import type { RawSignal, SignalAdapter, SignalAdapterContext } from "./types";

const FETCH_TIMEOUT_MS = 8_000;
const MAX_ITEMS = 10;
const SEARCH_FORMS = ["8-K", "10-K", "10-Q"];

/**
 * SEC EDGAR full-text search - free, public, no API key. Only covers
 * companies that file with the SEC (US public companies), which is a real,
 * known limitation for a general watchlist of mostly-private companies -
 * this adapter simply returns nothing for anything it can't find, rather
 * than erroring.
 *
 * SEC requires every request to identify a real requester in the
 * User-Agent header (https://www.sec.gov/os/webmaster-faq#developers) -
 * unset/generic User-Agents get rate-limited or blocked, so this is
 * configurable via SEC_EDGAR_USER_AGENT rather than hard-coded.
 */
interface EdgarHit {
  _id: string;
  _source: {
    cik?: string;
    file_type?: string;
    file_date?: string;
    display_names?: string[];
  };
}

interface EdgarSearchResponse {
  hits?: { hits?: EdgarHit[] };
}

function buildDocumentUrl(hit: EdgarHit): string | null {
  const [accession, filename] = hit._id.split(":");
  const cik = hit._source.cik;
  if (!accession || !filename || !cik) return null;

  const accessionNoDashes = accession.replace(/-/g, "");
  const cikNumeric = String(Number(cik));
  if (!cikNumeric || cikNumeric === "NaN") return null;

  return `https://www.sec.gov/Archives/edgar/data/${cikNumeric}/${accessionNoDashes}/${filename}`;
}

export const secEdgarAdapter: SignalAdapter = {
  name: "sec_edgar",

  async fetchSignals(context: SignalAdapterContext): Promise<RawSignal[]> {
    const userAgent =
      process.env.SEC_EDGAR_USER_AGENT?.trim() ??
      "Cevoryn Radar research@cevoryn.com";

    const query = encodeURIComponent(`"${context.entityName}"`);
    const forms = SEARCH_FORMS.join(",");
    const url = `https://efts.sec.gov/LATEST/search-index?q=${query}&forms=${forms}`;

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { "User-Agent": userAgent, Accept: "application/json" },
      });
      if (!response.ok) return [];

      const data = (await response.json()) as EdgarSearchResponse;
      const hits = data.hits?.hits ?? [];

      const signals: RawSignal[] = [];
      for (const hit of hits.slice(0, MAX_ITEMS)) {
        const documentUrl = buildDocumentUrl(hit);
        if (!documentUrl) continue;

        const formType = hit._source.file_type ?? "filing";
        const companyLabel =
          hit._source.display_names?.[0] ?? context.entityName;
        const publishedAt = hit._source.file_date
          ? new Date(hit._source.file_date)
          : null;

        signals.push({
          source: "sec_edgar",
          sourceType: "SEC_FILING",
          sourceUrl: documentUrl,
          title: `${companyLabel} filed ${formType}`,
          rawContent: `${companyLabel} filed SEC form ${formType}${hit._source.file_date ? ` on ${hit._source.file_date}` : ""}.`,
          publishedAt:
            publishedAt && !Number.isNaN(publishedAt.getTime())
              ? publishedAt
              : null,
        });
      }

      return signals;
    } catch (_error) {
      return [];
    }
  },
};
