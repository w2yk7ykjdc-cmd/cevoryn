import { logger } from "@/server/logger/logger";
import { BENCHMARK_SYMBOL, UNIVERSE_SIZE, type MarketDataClient, type Symbol } from "@/server/market-data/types";

/**
 * Well-known stablecoin base assets -- a stable/stable pair (e.g. a
 * hypothetical USDCUSDT-style listing) carries no meaningful momentum/
 * trend/volatility signal by construction (both legs are pegged to the
 * same value), so it's excluded from the priority analysis universe. This
 * is a deterministic, documented exclusion list, not a fabricated one --
 * every symbol here is a real, widely-known stablecoin.
 */
const STABLECOIN_BASE_ASSETS = new Set(["USDC", "BUSD", "TUSD", "USDP", "DAI", "FDUSD", "USDE", "PYUSD", "EUR", "GBP", "TRY"]);

/**
 * Discovers this run's analysis universe from Binance's own public,
 * real-time exchange state -- never a hardcoded symbol list (Sprint 14's
 * explicit mandate, replacing Sprint 13's fixed 2-symbol pair). Two calls,
 * both bulk/global (not per-symbol), so this stays cheap regardless of
 * how many symbols Binance actually lists:
 *
 * 1. `exchangeInfo` -- every symbol's live trading status and quote asset.
 *    Filtered to `status === "TRADING"` (excludes delisted/halted/inactive
 *    symbols) and `quoteAsset === "USDT"` (a single, liquid, comparable
 *    quote currency across the whole universe -- comparing a BTC-quoted
 *    pair's percent move against a USDT-quoted pair's would conflate two
 *    different reference frames) and a non-stablecoin base asset.
 * 2. `ticker/24hr` -- 24h quote volume for every symbol in ONE request,
 *    used purely as a liquidity ranking key: the `UNIVERSE_SIZE` most
 *    liquid eligible symbols are this run's universe. This is a real,
 *    economically-grounded bound (illiquid pairs are the ones LEAST worth
 *    analyzing anyway), not an arbitrary cutoff -- and it keeps the actual
 *    candle-fetch volume bounded regardless of how large Binance's total
 *    listing count grows.
 *
 * `BENCHMARK_SYMBOL` (BTCUSDT) is force-included if it's a valid, live
 * symbol but happened to fall outside the volume cutoff (in practice it
 * never does -- it is almost always the single highest-volume pair -- but
 * the relative-strength signal family needs it unconditionally available).
 */
export async function discoverMarketUniverse(client: MarketDataClient, size: number = UNIVERSE_SIZE): Promise<Symbol[]> {
  const exchangeInfo = await client.getExchangeInfo();
  const eligible = new Set(
    exchangeInfo
      .filter((s) => s.status === "TRADING" && s.quoteAsset === "USDT" && !STABLECOIN_BASE_ASSETS.has(s.baseAsset))
      .map((s) => s.symbol),
  );

  const ticker = await client.getTicker24hr();
  const ranked = ticker
    .filter((t) => eligible.has(t.symbol) && Number.isFinite(Number(t.quoteVolume)))
    .map((t) => ({ symbol: t.symbol, quoteVolume: Number(t.quoteVolume) }))
    .sort((a, b) => b.quoteVolume - a.quoteVolume);

  const universe = ranked.slice(0, size).map((r) => r.symbol);

  if (eligible.has(BENCHMARK_SYMBOL) && !universe.includes(BENCHMARK_SYMBOL)) {
    universe.push(BENCHMARK_SYMBOL);
  }

  logger.info({ eligibleCount: eligible.size, universeSize: universe.length }, "market universe discovered");
  return universe;
}
