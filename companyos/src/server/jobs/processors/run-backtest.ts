import type { Prisma } from "@prisma/client";
import { getTenantScopedClient } from "@/server/db/tenant";
import { logger } from "@/server/logger/logger";
import { loadHistoricalDataset } from "@/server/intelligence/backtest/historical-binance-fetcher";
import { runBacktest } from "@/server/intelligence/backtest/service";
import type { BacktestRunConfig } from "@/server/intelligence/backtest/run-service";
import type { HistoricalDataset } from "@/server/intelligence/backtest/types";
import type { JobMap } from "@/server/jobs/types";

/** The real historical-data loader, injectable so tests can supply a synthetic, offline dataset instead -- the exact same "inject the client, default to the real one" pattern `market-scanner.ts#ingestMarketData` already established for `MarketDataClient`. Never itself makes a network call in a test. */
export type LoadDatasetFn = (symbols: string[], startMs: number, endMs: number) => Promise<HistoricalDataset>;

/**
 * Executes ONE persisted `BacktestRun` (Sprint 21) -- loads its stored
 * `config`, fetches REAL historical candle data (`loadHistoricalDataset`,
 * public Binance klines only), and calls Sprint 20's own UNCHANGED
 * `runBacktest` engine. Every security/determinism/no-look-ahead property
 * `runBacktest` already has is inherited unmodified -- this processor adds
 * only persistence around it, never a second computation.
 *
 * Idempotent: a row already `COMPLETED` or `FAILED` is left exactly as-is
 * (a retried/duplicated job delivery is a safe no-op, never a second
 * write, never a silently different result for the same run). A row still
 * `PENDING`/`RUNNING` is (re)executed -- since `runBacktest` is a pure
 * function of its `config` and freshly-fetched historical data, re-running
 * an interrupted attempt is always safe, just potentially against a
 * slightly later "now" if real time has passed (documented, not hidden:
 * see `BacktestRunConfig.windowDays`'s own doc comment).
 */
export async function runBacktestProcessor(payload: JobMap["run-backtest"], loadDataset: LoadDatasetFn = loadHistoricalDataset): Promise<void> {
  const { backtestRunId, organizationId } = payload;
  const scoped = getTenantScopedClient(organizationId);

  const run = await scoped.backtestRun.findUnique({ where: { id: backtestRunId } });
  if (!run) {
    logger.warn({ backtestRunId, organizationId }, "run-backtest: no matching BacktestRun row for this organization, skipping");
    return;
  }
  if (run.status === "COMPLETED" || run.status === "FAILED") {
    logger.debug({ backtestRunId, status: run.status }, "run-backtest: already terminal, skipping (idempotent no-op)");
    return;
  }

  await scoped.backtestRun.update({
    where: { id: backtestRunId },
    data: { status: "RUNNING", startedAt: run.startedAt ?? new Date() },
  });

  const config = run.config as BacktestRunConfig;

  try {
    const endMs = Date.now();
    const startMs = endMs - config.windowDays * 24 * 60 * 60 * 1000;
    const dataset = await loadDataset(config.symbols, startMs, endMs);
    const report = await runBacktest({
      organizationId,
      symbols: config.symbols,
      dataset,
      startingEquity: config.startingEquity,
    });

    await scoped.backtestRun.update({
      where: { id: backtestRunId },
      data: { status: "COMPLETED", result: report as unknown as Prisma.InputJsonValue, completedAt: new Date() },
    });
    logger.info({ backtestRunId, organizationId, closedTrades: report.run.closedTrades.length }, "run-backtest: completed");
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await scoped.backtestRun.update({
      where: { id: backtestRunId },
      data: { status: "FAILED", errorMessage, completedAt: new Date() },
    });
    logger.error({ backtestRunId, organizationId, err }, "run-backtest: failed");
    // Deliberately NOT re-thrown: the failure is already durably recorded
    // on the row itself (status FAILED + errorMessage), which is the
    // user-visible outcome. Re-throwing would additionally trigger
    // BullMQ's own attempts:5 exponential-backoff retry -- appropriate for
    // a transient infra hiccup, but this sprint does not yet distinguish
    // that from a permanent, real backtest failure (e.g. no historical
    // data available for a symbol), so retrying is not attempted rather
    // than guessed at. Documented as a known simplification, not silently
    // decided.
  }
}
