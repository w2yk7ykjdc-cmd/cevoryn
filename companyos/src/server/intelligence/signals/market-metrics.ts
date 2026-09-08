import { DAILY_WINDOW, MEDIUM_WINDOW, SHORT_WINDOW, type Candle } from "@/server/market-data/types";

/**
 * The shared, multi-timeframe numeric foundation every market signal rule
 * (momentum/trend/volume-anomaly/volatility/relative-strength) and the
 * opportunity/risk eligibility checks are built on -- computed ONCE per
 * symbol per run from the same 2 candle fetches (daily 1h x25, short 15m
 * x8), never refetched or recomputed per rule. Each field's economic
 * meaning:
 *
 * - `dailyPercentChange`: 24h close-to-close move -- the same "24h change"
 *   every exchange ticker surfaces, momentum's own primary input.
 * - `shortTermPercentChange`: the last ~2h's move -- whether the VERY
 *   recent price action still agrees with the 24h direction (a real
 *   reversal-detection input, not decoration).
 * - `mediumPercentChange`: the last ~12h's move -- distinguishes "one big
 *   candle drove the 24h number" from "this has been building for half a
 *   day."
 * - `trendConsistency`: fraction (0-1) of consecutive medium-window
 *   candles that closed in the SAME direction as the overall medium move
 *   -- a single outlier candle scores low even if the net % change is
 *   large; a genuinely sustained move scores high.
 * - `volumeRatio`: the most recent daily candle's volume divided by the
 *   average of the prior 24 -- "how much more (or less) is trading right
 *   now than usual," a real participation measure.
 * - `volatilityPct`: average (high-low)/close over the daily window -- a
 *   simplified true-range percentage, no external statistics library.
 * - `relativeStrength` is NOT computed here -- it needs a second symbol's
 *   `dailyPercentChange` (the benchmark's), so it's computed by the caller
 *   (`market-scanner.ts`) once both symbols' metrics exist.
 */
export type MarketMetrics = {
  symbol: string;
  dailyPercentChange: number;
  shortTermPercentChange: number;
  mediumPercentChange: number;
  trendConsistency: number;
  volumeRatio: number;
  volatilityPct: number;
  observedAt: string;
};

function percentChange(fromClose: number, toClose: number): number {
  if (fromClose <= 0) return 0;
  return ((toClose - fromClose) / fromClose) * 100;
}

/**
 * Requires the FULL requested window for both timeframes -- a partial
 * candle history (young listing, incomplete fetch) returns `null` rather
 * than computing metrics from an incomplete, misleading sample. "Not
 * enough evidence yet" is never conflated with a real, if smaller,
 * measured move.
 */
export function computeMarketMetrics(symbol: string, dailyCandles: Candle[], shortCandles: Candle[]): MarketMetrics | null {
  if (dailyCandles.length !== DAILY_WINDOW || shortCandles.length !== SHORT_WINDOW) return null;

  const dailyCloses = dailyCandles.map((c) => Number(c.close));
  const shortCloses = shortCandles.map((c) => Number(c.close));
  if (dailyCloses.some((v) => !Number.isFinite(v) || v <= 0) || shortCloses.some((v) => !Number.isFinite(v) || v <= 0)) return null;

  const dailyFirst = dailyCloses[0]!;
  const dailyLast = dailyCloses[dailyCloses.length - 1]!;
  const dailyPercentChange = percentChange(dailyFirst, dailyLast);

  const shortFirst = shortCloses[0]!;
  const shortLast = shortCloses[shortCloses.length - 1]!;
  const shortTermPercentChange = percentChange(shortFirst, shortLast);

  const mediumCloses = dailyCloses.slice(-MEDIUM_WINDOW);
  const mediumFirst = mediumCloses[0]!;
  const mediumLast = mediumCloses[mediumCloses.length - 1]!;
  const mediumPercentChange = percentChange(mediumFirst, mediumLast);

  const mediumDirection = mediumPercentChange >= 0 ? 1 : -1;
  let agreeingSteps = 0;
  for (let i = 1; i < mediumCloses.length; i++) {
    const step = mediumCloses[i]! - mediumCloses[i - 1]!;
    if ((step >= 0 ? 1 : -1) === mediumDirection) agreeingSteps += 1;
  }
  const trendConsistency = mediumCloses.length > 1 ? agreeingSteps / (mediumCloses.length - 1) : 0;

  const dailyVolumes = dailyCandles.map((c) => Number(c.volume));
  const baselineVolumes = dailyVolumes.slice(0, -1);
  const baselineAverage = baselineVolumes.reduce((sum, v) => sum + v, 0) / baselineVolumes.length;
  const mostRecentVolume = dailyVolumes[dailyVolumes.length - 1]!;
  const volumeRatio = baselineAverage > 0 ? mostRecentVolume / baselineAverage : 0;

  const rangePcts = dailyCandles.map((c) => {
    const high = Number(c.high);
    const low = Number(c.low);
    const close = Number(c.close);
    return close > 0 ? ((high - low) / close) * 100 : 0;
  });
  const volatilityPct = rangePcts.reduce((sum, v) => sum + v, 0) / rangePcts.length;

  return {
    symbol,
    dailyPercentChange: Math.round(dailyPercentChange * 100) / 100,
    shortTermPercentChange: Math.round(shortTermPercentChange * 100) / 100,
    mediumPercentChange: Math.round(mediumPercentChange * 100) / 100,
    trendConsistency: Math.round(trendConsistency * 100) / 100,
    volumeRatio: Math.round(volumeRatio * 100) / 100,
    volatilityPct: Math.round(volatilityPct * 100) / 100,
    observedAt: dailyCandles[dailyCandles.length - 1]!.closeTime.toISOString(),
  };
}
