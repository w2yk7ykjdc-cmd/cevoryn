import { prisma } from "@/server/db/client";
import { recordSignal } from "@/server/intelligence/signals/service";
import type { RecordSignalInput } from "@/server/intelligence/signals/types";
import { computeMarketMetrics, type MarketMetrics } from "@/server/intelligence/signals/market-metrics";
import {
  evaluateMarketPriceMomentum,
  RULE_NAME as MOMENTUM_RULE_NAME,
  RULE_VERSION as MOMENTUM_RULE_VERSION,
} from "@/server/intelligence/signals/rules/market-price-momentum";
import {
  evaluateMarketTrend,
  RULE_NAME as TREND_RULE_NAME,
  RULE_VERSION as TREND_RULE_VERSION,
} from "@/server/intelligence/signals/rules/market-trend";
import {
  evaluateMarketVolumeAnomaly,
  RULE_NAME as VOLUME_RULE_NAME,
  RULE_VERSION as VOLUME_RULE_VERSION,
} from "@/server/intelligence/signals/rules/market-volume-anomaly";
import {
  evaluateMarketVolatility,
  RULE_NAME as VOLATILITY_RULE_NAME,
  RULE_VERSION as VOLATILITY_RULE_VERSION,
} from "@/server/intelligence/signals/rules/market-volatility";
import {
  evaluateMarketRelativeStrength,
  RULE_NAME as RELATIVE_STRENGTH_RULE_NAME,
  RULE_VERSION as RELATIVE_STRENGTH_RULE_VERSION,
} from "@/server/intelligence/signals/rules/market-relative-strength";
import {
  classifyMarketRegime,
  RULE_NAME as REGIME_RULE_NAME,
  RULE_VERSION as REGIME_RULE_VERSION,
} from "@/server/intelligence/signals/rules/market-regime";
import { createBinancePublicClient } from "@/server/market-data/binance-client";
import { discoverMarketUniverse } from "@/server/market-data/universe";
import {
  BENCHMARK_SYMBOL,
  DAILY_INTERVAL,
  DAILY_WINDOW,
  SHORT_INTERVAL,
  SHORT_WINDOW,
  type Candle,
  type MarketDataClient,
} from "@/server/market-data/types";
import { logger } from "@/server/logger/logger";

const ORG_BATCH_SIZE = 50;
/** Bounded so this never fires an unbounded `Promise.all` across the whole discovered universe at once. */
const SYMBOL_CONCURRENCY = 5;

/**
 * Fires unconditionally (never threshold-gated, unlike the 5 named signal
 * families below) so `market-intelligence/generate.ts` (stage 2) always
 * has the real, complete numeric inputs to evaluate opportunity/risk
 * eligibility against — even for a symbol whose individual signals didn't
 * cross any of their own (higher) alert thresholds. This is the bridge
 * between the two stages: stage 2 reads this back rather than refetching
 * Binance or recomputing anything.
 */
export const METRICS_SNAPSHOT_RULE_NAME = "market_metrics_snapshot";
export const METRICS_SNAPSHOT_RULE_VERSION = "v1";

export type MarketMetricsSnapshotPayload = MarketMetrics & { relativeStrength: number };

export type IngestMarketDataResult = {
  symbolsProcessed: number;
  symbolsFailed: number;
  signalsDetected: number;
  organizationsScanned: number;
  signalsCreated: number;
  signalsUpdated: number;
  errors: number;
  durationMs: number;
};

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R | null>): Promise<(R | null)[]> {
  const results: (R | null)[] = new Array(items.length).fill(null);
  let cursor = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

type PendingSignal = Pick<
  RecordSignalInput,
  "type" | "sourceType" | "sourceId" | "severity" | "confidence" | "ruleName" | "ruleVersion" | "relatedEntityType" | "relatedEntityId" | "payload"
>;

type SymbolEvaluation = {
  symbol: string;
  metrics: MarketMetrics;
  dailyCandles: Candle[];
  signals: PendingSignal[];
};

async function fetchAndEvaluateSymbol(client: MarketDataClient, symbol: string): Promise<SymbolEvaluation | null> {
  const [dailyCandles, shortCandles] = await Promise.all([
    client.getCandles(symbol, DAILY_INTERVAL, DAILY_WINDOW),
    client.getCandles(symbol, SHORT_INTERVAL, SHORT_WINDOW),
  ]);

  const metrics = computeMarketMetrics(symbol, dailyCandles, shortCandles);
  if (!metrics) return null; // insufficient history -- no signal, never a guess (Sprint 13's own discipline)

  return { symbol, metrics, dailyCandles, signals: [] };
}

/** Every deterministic signal this symbol's metrics produce this run, including the always-on snapshot. */
function buildSignals(evaluation: SymbolEvaluation, benchmarkDailyPercentChange: number): PendingSignal[] {
  const { symbol, metrics, dailyCandles } = evaluation;
  const relativeStrength = Math.round((metrics.dailyPercentChange - benchmarkDailyPercentChange) * 100) / 100;

  const signals: PendingSignal[] = [
    {
      type: METRICS_SNAPSHOT_RULE_NAME,
      sourceType: "scanner",
      sourceId: `${symbol}:${DAILY_INTERVAL}`,
      severity: "low",
      confidence: 90,
      ruleName: METRICS_SNAPSHOT_RULE_NAME,
      ruleVersion: METRICS_SNAPSHOT_RULE_VERSION,
      relatedEntityType: "MarketSymbol",
      relatedEntityId: symbol,
      payload: { ...metrics, relativeStrength } satisfies MarketMetricsSnapshotPayload,
    },
  ];

  const momentum = evaluateMarketPriceMomentum(dailyCandles, symbol, DAILY_INTERVAL, DAILY_WINDOW);
  if (momentum) {
    signals.push({
      type: MOMENTUM_RULE_NAME,
      sourceType: "scanner",
      sourceId: `${symbol}:${DAILY_INTERVAL}`,
      severity: momentum.severity,
      confidence: momentum.confidence,
      ruleName: MOMENTUM_RULE_NAME,
      ruleVersion: MOMENTUM_RULE_VERSION,
      relatedEntityType: "MarketSymbol",
      relatedEntityId: symbol,
      payload: { direction: momentum.direction, ...momentum.evidence },
    });
  }

  const trend = evaluateMarketTrend(metrics);
  if (trend) {
    signals.push({
      type: TREND_RULE_NAME,
      sourceType: "scanner",
      sourceId: `${symbol}:${DAILY_INTERVAL}`,
      severity: trend.severity,
      confidence: trend.confidence,
      ruleName: TREND_RULE_NAME,
      ruleVersion: TREND_RULE_VERSION,
      relatedEntityType: "MarketSymbol",
      relatedEntityId: symbol,
      payload: { direction: trend.direction, ...trend.evidence },
    });
  }

  const volumeAnomaly = evaluateMarketVolumeAnomaly(metrics);
  if (volumeAnomaly) {
    signals.push({
      type: VOLUME_RULE_NAME,
      sourceType: "scanner",
      sourceId: `${symbol}:${DAILY_INTERVAL}`,
      severity: volumeAnomaly.severity,
      confidence: volumeAnomaly.confidence,
      ruleName: VOLUME_RULE_NAME,
      ruleVersion: VOLUME_RULE_VERSION,
      relatedEntityType: "MarketSymbol",
      relatedEntityId: symbol,
      payload: volumeAnomaly.evidence,
    });
  }

  const volatility = evaluateMarketVolatility(metrics);
  if (volatility) {
    signals.push({
      type: VOLATILITY_RULE_NAME,
      sourceType: "scanner",
      sourceId: `${symbol}:${DAILY_INTERVAL}`,
      severity: volatility.severity,
      confidence: volatility.confidence,
      ruleName: VOLATILITY_RULE_NAME,
      ruleVersion: VOLATILITY_RULE_VERSION,
      relatedEntityType: "MarketSymbol",
      relatedEntityId: symbol,
      payload: volatility.evidence,
    });
  }

  if (symbol !== BENCHMARK_SYMBOL) {
    const relativeStrengthEvaluation = evaluateMarketRelativeStrength(metrics, benchmarkDailyPercentChange);
    if (relativeStrengthEvaluation) {
      signals.push({
        type: RELATIVE_STRENGTH_RULE_NAME,
        sourceType: "scanner",
        sourceId: `${symbol}:${DAILY_INTERVAL}`,
        severity: relativeStrengthEvaluation.severity,
        confidence: relativeStrengthEvaluation.confidence,
        ruleName: RELATIVE_STRENGTH_RULE_NAME,
        ruleVersion: RELATIVE_STRENGTH_RULE_VERSION,
        relatedEntityType: "MarketSymbol",
        relatedEntityId: symbol,
        payload: { direction: relativeStrengthEvaluation.direction, ...relativeStrengthEvaluation.evidence },
      });
    }
  }

  return signals;
}

/**
 * Fetches candles for every symbol in this run's dynamically-discovered
 * universe (`discoverMarketUniverse`, replacing Sprint 13's hardcoded
 * pair), computes deterministic multi-timeframe metrics and all 5 signal
 * families plus the overall market regime, then upserts the resulting
 * `CompanySignal` rows for every organization — the only way to satisfy
 * tenant-scoped storage given `CompanySignal.organizationId` is required.
 * Mirrors `scan-company-signals`'s cursor-paged, per-organization-isolated
 * shape, plus symbol-level isolation: one symbol's fetch/validation
 * failure is logged and skipped, never preventing another symbol (or the
 * regime classification, which only needs the benchmark) from being
 * processed in the same run. Bounded concurrency (`SYMBOL_CONCURRENCY`)
 * across the rest of the universe, after the benchmark is evaluated first
 * since relative-strength for every other symbol needs its result.
 *
 * `client` is injectable so tests can supply a mock and NEVER make a real
 * network call — defaults to the real Binance public client.
 */
export async function ingestMarketData(client: MarketDataClient = createBinancePublicClient()): Promise<IngestMarketDataResult> {
  const start = Date.now();
  let symbolsProcessed = 0;
  let symbolsFailed = 0;
  let signalsDetected = 0;
  let organizationsScanned = 0;
  let signalsCreated = 0;
  let signalsUpdated = 0;
  let errors = 0;

  const universe = await discoverMarketUniverse(client);
  logger.info({ universeSize: universe.length }, "market data ingestion started");

  let benchmarkEvaluation: SymbolEvaluation | null = null;
  try {
    benchmarkEvaluation = await fetchAndEvaluateSymbol(client, BENCHMARK_SYMBOL);
  } catch (err) {
    logger.error({ err, symbol: BENCHMARK_SYMBOL }, "benchmark symbol fetch failed, regime and relative strength unavailable this run");
  }

  const restOfUniverse = universe.filter((symbol) => symbol !== BENCHMARK_SYMBOL);
  const benchmarkDailyPercentChange = benchmarkEvaluation?.metrics.dailyPercentChange ?? 0;

  async function processSymbol(symbol: string): Promise<void> {
    let evaluation: SymbolEvaluation | null;
    try {
      evaluation = await fetchAndEvaluateSymbol(client, symbol);
    } catch (err) {
      symbolsFailed += 1;
      logger.error({ err, symbol }, "market data fetch failed, skipping this symbol for this run");
      return;
    }
    if (!evaluation) {
      logger.debug({ symbol }, "insufficient candle history, skipping this symbol for this run");
      return;
    }

    symbolsProcessed += 1;
    const signals = buildSignals(evaluation, benchmarkDailyPercentChange);
    signalsDetected += signals.length - 1; // exclude the always-on metrics snapshot from the "notable signal" count
    logger.info({ symbol, signalCount: signals.length - 1 }, "market signals evaluated");

    const fanOutResult = await fanOutSignalsToOrganizations(signals);
    organizationsScanned = Math.max(organizationsScanned, fanOutResult.organizationsScanned);
    signalsCreated += fanOutResult.signalsCreated;
    signalsUpdated += fanOutResult.signalsUpdated;
    errors += fanOutResult.errors;
  }

  if (benchmarkEvaluation) {
    symbolsProcessed += 1;
    const benchmarkSignals = buildSignals(benchmarkEvaluation, benchmarkDailyPercentChange);
    signalsDetected += benchmarkSignals.length - 1;
    const benchmarkFanOut = await fanOutSignalsToOrganizations(benchmarkSignals);
    organizationsScanned = Math.max(organizationsScanned, benchmarkFanOut.organizationsScanned);
    signalsCreated += benchmarkFanOut.signalsCreated;
    signalsUpdated += benchmarkFanOut.signalsUpdated;
    errors += benchmarkFanOut.errors;

    const regime = classifyMarketRegime(benchmarkEvaluation.metrics);
    logger.info({ regime: regime.regime }, "market regime classified");
    const regimeSignal: PendingSignal = {
      type: REGIME_RULE_NAME,
      sourceType: "scanner",
      sourceId: "GLOBAL",
      severity: regime.severity,
      confidence: regime.confidence,
      ruleName: REGIME_RULE_NAME,
      ruleVersion: REGIME_RULE_VERSION,
      relatedEntityType: "Market",
      relatedEntityId: "GLOBAL",
      payload: { regime: regime.regime, ...regime.evidence },
    };
    const regimeFanOut = await fanOutSignalsToOrganizations([regimeSignal]);
    organizationsScanned = Math.max(organizationsScanned, regimeFanOut.organizationsScanned);
    signalsCreated += regimeFanOut.signalsCreated;
    signalsUpdated += regimeFanOut.signalsUpdated;
    errors += regimeFanOut.errors;
  } else {
    symbolsFailed += 1;
  }

  await mapWithConcurrency(restOfUniverse, SYMBOL_CONCURRENCY, processSymbol);

  const durationMs = Date.now() - start;
  logger.info(
    { symbolsProcessed, symbolsFailed, signalsDetected, organizationsScanned, signalsCreated, signalsUpdated, errors, durationMs },
    "market data ingestion completed",
  );

  // One bad symbol never aborts the run for the others (isolation above),
  // but if EVERY symbol failed this run genuinely produced nothing and
  // should count as a failed job -- letting BullMQ's own `attempts: 5` /
  // exponential backoff (`queue.ts`) retry sooner than waiting a full hour
  // for the next scheduled run, rather than silently "succeeding" empty.
  if (symbolsFailed > 0 && symbolsProcessed === 0) {
    throw new Error(`market data ingestion failed for all ${symbolsFailed} symbol(s) this run`);
  }

  return { symbolsProcessed, symbolsFailed, signalsDetected, organizationsScanned, signalsCreated, signalsUpdated, errors, durationMs };
}

async function fanOutSignalsToOrganizations(
  signals: PendingSignal[],
): Promise<{ organizationsScanned: number; signalsCreated: number; signalsUpdated: number; errors: number }> {
  let cursor: string | undefined;
  let organizationsScanned = 0;
  let signalsCreated = 0;
  let signalsUpdated = 0;
  let errors = 0;

  for (;;) {
    const organizations = await prisma.organization.findMany({
      take: ORG_BATCH_SIZE,
      orderBy: { id: "asc" },
      select: { id: true },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (organizations.length === 0) break;

    for (const organization of organizations) {
      try {
        for (const signal of signals) {
          const { outcome } = await recordSignal({ organizationId: organization.id, ...signal });
          if (outcome === "created") signalsCreated += 1;
          else signalsUpdated += 1;
        }
        organizationsScanned += 1;
      } catch (err) {
        errors += 1;
        logger.error({ err, organizationId: organization.id }, "market signal upsert failed for organization");
      }
    }

    cursor = organizations[organizations.length - 1]?.id;
    if (organizations.length < ORG_BATCH_SIZE) break;
  }

  return { organizationsScanned, signalsCreated, signalsUpdated, errors };
}
