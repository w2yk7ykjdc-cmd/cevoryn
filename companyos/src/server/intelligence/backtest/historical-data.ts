import {
  BENCHMARK_SYMBOL,
  DAILY_INTERVAL,
  MarketDataProviderError,
  SHORT_INTERVAL,
  type Candle,
  type ExchangeSymbolInfo,
  type MarketDataClient,
  type Ticker24hr,
} from "@/server/market-data/types";
import type { HistoricalDataset } from "@/server/intelligence/backtest/types";

/**
 * A mutable "as of" pointer the replay engine (`engine.ts`) advances one
 * step at a time. This is the SINGLE structural mechanism that makes
 * look-ahead bias impossible rather than merely discouraged: every
 * `getCandles` call below is answered strictly from `cursor.asOfMs`
 * backward, regardless of how much MORE data `dataset` actually contains
 * beyond that point. A caller cannot bypass this by asking for a larger
 * `limit` or a different symbol -- the cutoff is enforced per-call, inside
 * the client itself, not by caller discipline.
 */
export type AsOfCursor = { asOfMs: number };

/**
 * Returns the most recent `windowSize` candles whose `closeTime` is at or
 * before `asOfMs`, assuming `candles` is already in ascending `closeTime`
 * order (the caller's contract -- see `HistoricalSymbolCandles`'s own doc
 * comment). Returns `null` when fewer than `windowSize` such candles exist
 * yet -- the exact same "not enough evidence yet, never a partial/guessed
 * computation" contract `computeMarketMetrics` itself already enforces, so
 * this never masks a real warmup gap as if it were a normal empty result.
 */
export function sliceCandlesAsOf(candles: Candle[], asOfMs: number, windowSize: number): Candle[] | null {
  let end = candles.length;
  while (end > 0 && candles[end - 1]!.closeTime.getTime() > asOfMs) end -= 1;
  const start = end - windowSize;
  if (start < 0) return null;
  const window = candles.slice(start, end);
  return window.length === windowSize ? window : null;
}

/**
 * A `MarketDataClient` implementation backed by pre-loaded, real historical
 * candle data instead of a live Binance connection -- deliberately a
 * SEPARATE module from `binance-client.ts` (Phase 2's own explicit
 * requirement: "historical provider ile live Binance provider birbirinden
 * ayrılmalı"), sharing only the same narrow interface shape so every
 * downstream consumer of `MarketDataClient` (`computeMarketMetrics` via a
 * `getCandles` call, `market-scanner.ts`'s own fetch pattern) works
 * unmodified against either one. Carries zero account/order/credential
 * surface -- it cannot call the Binance private API even in principle,
 * since it never makes a network call of any kind.
 */
export function createHistoricalMarketDataClient(dataset: HistoricalDataset, cursor: AsOfCursor): MarketDataClient {
  return {
    async getCandles(symbol: string, interval: string, limit: number): Promise<Candle[]> {
      const series = dataset[symbol];
      if (!series) throw new MarketDataProviderError(`historical replay: no candle data loaded for symbol ${symbol}`);

      const source = interval === DAILY_INTERVAL ? series.daily : interval === SHORT_INTERVAL ? series.short : null;
      if (!source) throw new MarketDataProviderError(`historical replay: unsupported interval "${interval}" for symbol ${symbol}`);

      const window = sliceCandlesAsOf(source, cursor.asOfMs, limit);
      if (!window) {
        throw new MarketDataProviderError(
          `historical replay: insufficient candle history for ${symbol}/${interval} as of ${new Date(cursor.asOfMs).toISOString()}`,
        );
      }
      return window;
    },

    // Never called by the replay engine itself (Sprint 20's universe is the
    // caller's own explicit `BacktestConfig.symbols`, never
    // `discoverMarketUniverse` -- see `types.ts#BacktestConfig.symbols`'s
    // own doc comment for why). Implemented trivially, from the dataset's
    // own known symbol keys, purely so this object satisfies the
    // `MarketDataClient` interface for any code path that might introspect
    // it generically.
    async getExchangeInfo(): Promise<ExchangeSymbolInfo[]> {
      return Object.keys(dataset).map((symbol) => ({
        symbol,
        baseAsset: symbol.replace(/USDT$/, ""),
        quoteAsset: "USDT",
        status: "TRADING",
      }));
    },
    async getTicker24hr(): Promise<Ticker24hr[]> {
      return Object.keys(dataset).map((symbol) => ({ symbol, quoteVolume: "0" }));
    },
  };
}

/** Every distinct, ascending `closeTime` present in this symbol's DAILY series -- the candidate set of replay step times (Phase 3), since the live pipeline itself advances once per daily (1h) candle close. */
function dailyCloseTimes(dataset: HistoricalDataset, symbol: string): number[] {
  return (dataset[symbol]?.daily ?? []).map((c) => c.closeTime.getTime());
}

/**
 * The full, deduplicated, ascending list of replay step times across every
 * requested symbol's daily series (Phase 3/4) -- the union, not the
 * intersection, so a symbol whose history starts later or has a gap simply
 * has no valid decision at the steps it lacks data for (handled per-symbol
 * inside the replay loop as `insufficient_evidence`, never by shrinking the
 * whole run's timeline to the shortest series). `BENCHMARK_SYMBOL` is
 * always included even if the caller's own `symbols` list omitted it, since
 * regime classification and every symbol's relative-strength computation
 * need it unconditionally (matching `ingest-market-data`'s own
 * benchmark-first precedent).
 */
export function computeReplayStepTimes(dataset: HistoricalDataset, symbols: string[]): number[] {
  const allSymbols = symbols.includes(BENCHMARK_SYMBOL) ? symbols : [...symbols, BENCHMARK_SYMBOL];
  const set = new Set<number>();
  for (const symbol of allSymbols) {
    for (const t of dailyCloseTimes(dataset, symbol)) set.add(t);
  }
  return [...set].sort((a, b) => a - b);
}
