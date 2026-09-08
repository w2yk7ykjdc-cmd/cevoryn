import { prisma } from "@/server/db/client";
import { recordSignal } from "@/server/intelligence/signals/service";
import { evaluateMarketPriceMomentum, RULE_NAME, RULE_VERSION } from "@/server/intelligence/signals/rules/market-price-momentum";
import { createBinancePublicClient } from "@/server/market-data/binance-client";
import { CANDLE_INTERVAL, CANDLE_WINDOW, SUPPORTED_SYMBOLS, type MarketDataClient } from "@/server/market-data/types";
import { logger } from "@/server/logger/logger";

const ORG_BATCH_SIZE = 50;

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

/**
 * Fetches candles for each of `SUPPORTED_SYMBOLS` (a small, fixed set —
 * see `market-data/types.ts`), evaluates the deterministic momentum rule
 * ONCE per symbol (market data is global, not per-organization), then, if
 * the rule fired, upserts the resulting `CompanySignal` for every
 * organization — the only way to satisfy tenant-scoped storage given
 * `CompanySignal.organizationId` is required. Mirrors
 * `scanCompanySignals`'s cursor-paged, per-organization-isolated shape
 * exactly, plus a second layer of isolation at the symbol level: one
 * symbol's fetch/validation failure is logged and skipped, never
 * preventing the other symbol(s) from being processed in the same run.
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

  for (const symbol of SUPPORTED_SYMBOLS) {
    logger.info({ symbol, interval: CANDLE_INTERVAL }, "market data fetch started");

    let candles;
    try {
      candles = await client.getCandles(symbol, CANDLE_INTERVAL, CANDLE_WINDOW);
    } catch (err) {
      symbolsFailed += 1;
      logger.error({ err, symbol }, "market data fetch failed, skipping this symbol for this run");
      continue;
    }

    logger.info({ symbol, candleCount: candles.length }, "market data fetch succeeded");
    symbolsProcessed += 1;

    const evaluation = evaluateMarketPriceMomentum(candles, symbol, CANDLE_INTERVAL, CANDLE_WINDOW);
    if (!evaluation) {
      logger.debug({ symbol }, "no market signal (below threshold or insufficient data)");
      continue;
    }

    logger.info({ symbol, severity: evaluation.severity, direction: evaluation.direction }, "market signal detected");
    signalsDetected += 1;

    const fanOutResult = await fanOutSignalToOrganizations(symbol, evaluation);
    organizationsScanned += fanOutResult.organizationsScanned;
    signalsCreated += fanOutResult.signalsCreated;
    signalsUpdated += fanOutResult.signalsUpdated;
    errors += fanOutResult.errors;
  }

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
    throw new Error(`market data ingestion failed for all ${symbolsFailed} configured symbol(s) this run`);
  }

  return { symbolsProcessed, symbolsFailed, signalsDetected, organizationsScanned, signalsCreated, signalsUpdated, errors, durationMs };
}

async function fanOutSignalToOrganizations(
  symbol: string,
  evaluation: NonNullable<ReturnType<typeof evaluateMarketPriceMomentum>>,
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
        // `sourceId` includes the interval (not just the symbol) so a
        // future second interval for the same symbol can never collide on
        // this upsert key — see the rule module's own idempotency shape.
        const { outcome } = await recordSignal({
          organizationId: organization.id,
          type: RULE_NAME,
          sourceType: "scanner",
          sourceId: `${symbol}:${CANDLE_INTERVAL}`,
          severity: evaluation.severity,
          confidence: evaluation.confidence,
          ruleName: RULE_NAME,
          ruleVersion: RULE_VERSION,
          relatedEntityType: "MarketSymbol",
          relatedEntityId: symbol,
          payload: { direction: evaluation.direction, ...evaluation.evidence },
        });
        organizationsScanned += 1;
        if (outcome === "created") signalsCreated += 1;
        else signalsUpdated += 1;
      } catch (err) {
        errors += 1;
        logger.error({ err, organizationId: organization.id, symbol }, "market signal upsert failed for organization");
      }
    }

    cursor = organizations[organizations.length - 1]?.id;
    if (organizations.length < ORG_BATCH_SIZE) break;
  }

  return { organizationsScanned, signalsCreated, signalsUpdated, errors };
}
