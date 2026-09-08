import { logger } from "@/server/logger/logger";
import {
  MarketDataAuthError,
  MarketDataMalformedResponseError,
  MarketDataProviderError,
  MarketDataRateLimitError,
  MarketDataTimeoutError,
  type Candle,
  type MarketDataClient,
  type SupportedSymbol,
} from "@/server/market-data/types";

const BASE_URL = "https://api.binance.com";
const REQUEST_TIMEOUT_MS = 10_000;

/** Binance's own raw kline row shape -- see api.binance.com/api/v3/klines docs. Index 0-6 are the fields this module uses. */
type RawKline = [number, string, string, string, string, string, number, ...unknown[]];

function isRawKline(value: unknown): value is RawKline {
  return (
    Array.isArray(value) &&
    value.length >= 7 &&
    typeof value[0] === "number" &&
    typeof value[1] === "string" &&
    typeof value[2] === "string" &&
    typeof value[3] === "string" &&
    typeof value[4] === "string" &&
    typeof value[5] === "string" &&
    typeof value[6] === "number"
  );
}

function parseKlinesResponse(body: unknown, symbol: string): Candle[] {
  if (!Array.isArray(body)) {
    throw new MarketDataMalformedResponseError(`expected an array of klines for ${symbol}, got ${typeof body}`);
  }

  return body.map((row, index): Candle => {
    if (!isRawKline(row)) {
      throw new MarketDataMalformedResponseError(`malformed kline row at index ${index} for ${symbol}`);
    }
    const [openTimeMs, open, high, low, close, volume, closeTimeMs] = row;

    if (!Number.isFinite(openTimeMs) || !Number.isFinite(closeTimeMs) || closeTimeMs <= openTimeMs) {
      throw new MarketDataMalformedResponseError(`invalid timestamp pair at index ${index} for ${symbol}`);
    }
    for (const [label, value] of [
      ["open", open],
      ["high", high],
      ["low", low],
      ["close", close],
      ["volume", volume],
    ] as const) {
      if (!Number.isFinite(Number(value))) {
        throw new MarketDataMalformedResponseError(`non-numeric ${label} at index ${index} for ${symbol}`);
      }
    }

    return {
      openTime: new Date(openTimeMs),
      closeTime: new Date(closeTimeMs),
      open,
      high,
      low,
      close,
      volume,
    };
  });
}

/**
 * Minimal Binance public REST client -- deliberately not an SDK dependency
 * (mirrors `src/server/jobs/email.ts`'s Resend client, the existing
 * precedent for "a single external GET/POST doesn't need a package").
 * Public market-data endpoints only: no API key, no signing, no account
 * scope. A single attempt per call, timeout-bounded via `AbortController`
 * (this codebase's first use of it) -- deliberately no internal retry loop
 * here; `ingest-market-data`'s per-symbol try/catch handles a failed
 * fetch by skipping that symbol for this run, and BullMQ's own
 * job-level `attempts: 5` / exponential backoff (`queue.ts`) already
 * provides retry-on-total-failure without a second, competing retry
 * system layered on top (Sprint 13 rule: reuse existing retry
 * infrastructure, don't invent a parallel one).
 */
export function createBinancePublicClient(): MarketDataClient {
  return {
    async getCandles(symbol: SupportedSymbol, interval: string, limit: number): Promise<Candle[]> {
      const url = `${BASE_URL}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch(url, { signal: controller.signal });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          throw new MarketDataTimeoutError(`Binance klines request timed out for ${symbol}`);
        }
        throw new MarketDataProviderError(`network error fetching Binance klines for ${symbol}: ${String(err)}`);
      } finally {
        clearTimeout(timeout);
      }

      if (response.status === 429 || response.status === 418) {
        const retryAfterHeader = response.headers.get("retry-after");
        throw new MarketDataRateLimitError(
          `Binance rate limit hit fetching ${symbol}`,
          retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined,
        );
      }
      if (response.status === 401 || response.status === 403) {
        throw new MarketDataAuthError(`Binance rejected the request for ${symbol} as unauthorized (status ${response.status})`);
      }
      if (!response.ok) {
        const bodyText = await response.text().catch(() => "");
        throw new MarketDataProviderError(`Binance returned ${response.status} for ${symbol}: ${bodyText.slice(0, 200)}`, response.status);
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new MarketDataMalformedResponseError(`Binance response for ${symbol} was not valid JSON`);
      }

      const candles = parseKlinesResponse(body, symbol);
      logger.debug({ symbol, interval, candleCount: candles.length }, "binance klines fetch succeeded");
      return candles;
    },
  };
}
