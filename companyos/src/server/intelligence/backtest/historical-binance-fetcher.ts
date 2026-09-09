import { fetchJson, parseKlinesResponse } from "@/server/market-data/binance-client";
import { BENCHMARK_SYMBOL, DAILY_INTERVAL, SHORT_INTERVAL, type Candle } from "@/server/market-data/types";
import type { HistoricalDataset, HistoricalSymbolCandles } from "@/server/intelligence/backtest/types";

/** Binance's own hard per-request cap on `/api/v3/klines`. */
const BINANCE_KLINES_MAX_LIMIT = 1000;

/**
 * Pages Binance's PUBLIC `/api/v3/klines` endpoint across a real historical
 * `[startMs, endMs)` time range -- the same public, no-auth, no-account
 * endpoint `createBinancePublicClient` already uses for "most recent N
 * candles," just with `startTime`/`endTime` instead of `limit` alone (still
 * a documented, public Binance REST parameter -- not a private/account
 * endpoint of any kind). Reuses `fetchJson`/`parseKlinesResponse` verbatim
 * (Sprint 13) rather than a second HTTP/parsing layer. Results are returned
 * in Binance's own ascending `openTime` order, matching
 * `HistoricalSymbolCandles`'s own ascending-order contract.
 */
export async function fetchHistoricalKlines(symbol: string, interval: string, startMs: number, endMs: number): Promise<Candle[]> {
  const candles: Candle[] = [];
  let cursor = startMs;

  while (cursor < endMs) {
    const body = await fetchJson(
      `/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${cursor}&endTime=${endMs}&limit=${BINANCE_KLINES_MAX_LIMIT}`,
      `historical klines for ${symbol}/${interval}`,
    );
    const page = parseKlinesResponse(body, symbol);
    if (page.length === 0) break;
    candles.push(...page);

    const lastCloseMs = page[page.length - 1]!.closeTime.getTime();
    if (lastCloseMs <= cursor) break; // defensive: never loop forever on a non-advancing response
    cursor = lastCloseMs + 1;
    if (page.length < BINANCE_KLINES_MAX_LIMIT) break; // short page -- this was the last one
  }

  return candles;
}

/**
 * Builds a full `HistoricalDataset` (Phase 2) for a real backtest run by
 * fetching BOTH timeframes the live pipeline itself uses (`DAILY_INTERVAL`
 * 1h, `SHORT_INTERVAL` 15m) for every requested symbol plus
 * `BENCHMARK_SYMBOL` (added automatically if the caller omitted it, exactly
 * matching `computeReplayStepTimes`'s own unconditional benchmark
 * inclusion). Makes REAL network calls to Binance's public REST API --
 * deliberately NOT used by the deterministic Sprint 20 test suite, which
 * injects synthetic `HistoricalDataset`s directly so every test stays fast,
 * offline, and reproducible regardless of network conditions.
 */
export async function loadHistoricalDataset(symbols: string[], startMs: number, endMs: number): Promise<HistoricalDataset> {
  const allSymbols = symbols.includes(BENCHMARK_SYMBOL) ? symbols : [...symbols, BENCHMARK_SYMBOL];
  const dataset: HistoricalDataset = {};

  await Promise.all(
    allSymbols.map(async (symbol) => {
      const [daily, short] = await Promise.all([
        fetchHistoricalKlines(symbol, DAILY_INTERVAL, startMs, endMs),
        fetchHistoricalKlines(symbol, SHORT_INTERVAL, startMs, endMs),
      ]);
      dataset[symbol] = { daily, short } satisfies HistoricalSymbolCandles;
    }),
  );

  return dataset;
}
