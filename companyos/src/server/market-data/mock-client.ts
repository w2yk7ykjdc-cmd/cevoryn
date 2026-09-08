import {
  MarketDataMalformedResponseError,
  MarketDataProviderError,
  MarketDataRateLimitError,
  MarketDataTimeoutError,
  type Candle,
  type ExchangeSymbolInfo,
  type MarketDataClient,
  type Symbol,
  type Ticker24hr,
} from "@/server/market-data/types";

export type MockCandleResponse = Candle[] | "rate_limited" | "timeout" | "malformed" | "provider_error";

/**
 * Test-only `MarketDataClient` -- never makes a real network call, never
 * touches a real Binance account (there is no account concept here at
 * all). Every Sprint 13/14 test that needs candle or universe data injects
 * this instead of `createBinancePublicClient()`.
 *
 * `candleResponses` keeps Sprint 13's exact original call shape (a flat
 * symbol -> response map) so every Sprint 13 test keeps compiling and
 * passing unchanged. When `universeOverride` is omitted, `getExchangeInfo`/
 * `getTicker24hr` default to describing EXACTLY the keys of
 * `candleResponses` as TRADING, USDT-quoted symbols in descending mock
 * volume order -- so Sprint 13's tests, which only ever configured
 * BTCUSDT/ETHUSDT candles, still resolve to exactly that discovered
 * universe under Sprint 14's new universe-discovery step, with no changes
 * needed to those test bodies.
 */
export function createMockMarketDataClient(
  candleResponses: Partial<Record<string, MockCandleResponse>>,
  universeOverride?: { exchangeInfo?: ExchangeSymbolInfo[]; ticker24hr?: Ticker24hr[] },
): MarketDataClient {
  const symbols = Object.keys(candleResponses);

  const defaultExchangeInfo: ExchangeSymbolInfo[] = symbols.map((symbol) => ({
    symbol,
    baseAsset: symbol.replace(/USDT$/, ""),
    quoteAsset: "USDT",
    status: "TRADING",
  }));
  const defaultTicker24hr: Ticker24hr[] = symbols.map((symbol, index) => ({
    symbol,
    quoteVolume: String((symbols.length - index) * 1_000_000),
  }));

  return {
    async getCandles(symbol: Symbol, _interval: string, limit: number): Promise<Candle[]> {
      const response = candleResponses[symbol];
      if (response === undefined) {
        throw new MarketDataProviderError(`no mock response configured for ${symbol}`);
      }
      if (response === "rate_limited") throw new MarketDataRateLimitError(`mock rate limit for ${symbol}`, 1000);
      if (response === "timeout") throw new MarketDataTimeoutError(`mock timeout for ${symbol}`);
      if (response === "malformed") throw new MarketDataMalformedResponseError(`mock malformed response for ${symbol}`);
      if (response === "provider_error") throw new MarketDataProviderError(`mock provider error for ${symbol}`, 500);
      // A single configured candle array serves both the daily (25) and short
      // (8) windows a real fetch would request separately -- slicing to the
      // most recent `limit` candles keeps every existing Sprint 13 test
      // (which only configures one array per symbol) working unchanged
      // against Sprint 14's now-two-fetches-per-symbol pipeline.
      return response.length > limit ? response.slice(-limit) : response;
    },
    async getExchangeInfo(): Promise<ExchangeSymbolInfo[]> {
      return universeOverride?.exchangeInfo ?? defaultExchangeInfo;
    },
    async getTicker24hr(): Promise<Ticker24hr[]> {
      return universeOverride?.ticker24hr ?? defaultTicker24hr;
    },
  };
}

/**
 * Builds `count` synthetic candles ending "now", `interval` minutes apart,
 * with `close` prices moving linearly from `startClose` to `endClose` --
 * the shape every deterministic-signal test needs, without hand-writing
 * candle objects per test case. `volumeMultiplier` lets a test simulate a
 * volume spike on the most recent candle (for volume-anomaly tests).
 */
export function buildSyntheticCandles(
  count: number,
  startClose: number,
  endClose: number,
  intervalMinutes = 60,
  volumeMultiplier: (index: number, count: number) => number = () => 1,
): Candle[] {
  const candles: Candle[] = [];
  const now = Date.now();
  const stepMs = intervalMinutes * 60 * 1000;

  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1);
    const close = startClose + (endClose - startClose) * t;
    const openTimeMs = now - (count - i) * stepMs;
    const baseVolume = 100;
    candles.push({
      openTime: new Date(openTimeMs),
      closeTime: new Date(openTimeMs + stepMs - 1),
      open: close.toFixed(2),
      high: close.toFixed(2),
      low: close.toFixed(2),
      close: close.toFixed(2),
      volume: (baseVolume * volumeMultiplier(i, count)).toFixed(8),
    });
  }

  return candles;
}
