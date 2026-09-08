import {
  MarketDataMalformedResponseError,
  MarketDataProviderError,
  MarketDataRateLimitError,
  MarketDataTimeoutError,
  type Candle,
  type MarketDataClient,
  type SupportedSymbol,
} from "@/server/market-data/types";

/**
 * Test-only `MarketDataClient` -- never makes a real network call, never
 * touches a real Binance account (there is no account concept here at
 * all). Every Sprint 13 test that needs candle data injects this instead
 * of `createBinancePublicClient()`.
 */
export function createMockMarketDataClient(
  responses: Partial<Record<SupportedSymbol, Candle[] | "rate_limited" | "timeout" | "malformed" | "provider_error">>,
): MarketDataClient {
  return {
    async getCandles(symbol: SupportedSymbol): Promise<Candle[]> {
      const response = responses[symbol];
      if (response === undefined) {
        throw new MarketDataProviderError(`no mock response configured for ${symbol}`);
      }
      if (response === "rate_limited") throw new MarketDataRateLimitError(`mock rate limit for ${symbol}`, 1000);
      if (response === "timeout") throw new MarketDataTimeoutError(`mock timeout for ${symbol}`);
      if (response === "malformed") throw new MarketDataMalformedResponseError(`mock malformed response for ${symbol}`);
      if (response === "provider_error") throw new MarketDataProviderError(`mock provider error for ${symbol}`, 500);
      return response;
    },
  };
}

/**
 * Builds `count` synthetic hourly candles ending "now", with `close` prices
 * moving linearly from `startClose` to `endClose` -- the shape every
 * momentum-rule test needs, without hand-writing 25 candle objects per
 * test case.
 */
export function buildSyntheticCandles(count: number, startClose: number, endClose: number): Candle[] {
  const candles: Candle[] = [];
  const now = Date.now();
  const hourMs = 60 * 60 * 1000;

  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1);
    const close = startClose + (endClose - startClose) * t;
    const openTimeMs = now - (count - i) * hourMs;
    candles.push({
      openTime: new Date(openTimeMs),
      closeTime: new Date(openTimeMs + hourMs - 1),
      open: close.toFixed(2),
      high: close.toFixed(2),
      low: close.toFixed(2),
      close: close.toFixed(2),
      volume: "100.00000000",
    });
  }

  return candles;
}
