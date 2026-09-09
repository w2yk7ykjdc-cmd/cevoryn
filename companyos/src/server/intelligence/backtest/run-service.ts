import type { BacktestRunStatus, Prisma } from "@prisma/client";
import { getTenantScopedClient, CrossTenantAccessError } from "@/server/db/tenant";
import { enqueue } from "@/server/jobs/queue";
import { BENCHMARK_SYMBOL } from "@/server/market-data/types";
import { DEFAULT_STARTING_EQUITY } from "@/server/intelligence/paper-trading/constants";
import { MAX_COMPARISON_RUNS, MAX_RUN_LABEL_LENGTH, MAX_RUN_SYMBOLS, MAX_RUN_WINDOW_DAYS, MIN_RUN_WINDOW_DAYS } from "@/server/intelligence/backtest/constants";
import type { BacktestReport } from "@/server/intelligence/backtest/service";

/**
 * The small, storable subset of a real `BacktestConfig` (Sprint 20) --
 * symbols, the requested historical window (expressed as a day count
 * relative to "when the job actually runs," never a fixed absolute
 * timestamp chosen at request time, so a queued-but-delayed job still
 * replays the most recent real window rather than a stale one) and
 * starting equity. The real candle data itself is fetched fresh by the job
 * processor, never persisted here.
 */
export type BacktestRunConfig = {
  symbols: string[];
  windowDays: number;
  startingEquity?: number;
};

export type BacktestRunSummary = {
  id: string;
  label: string;
  status: BacktestRunStatus;
  config: BacktestRunConfig;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
};

export type BacktestRunDetail = BacktestRunSummary & { result: BacktestReport | null };

function toSummary(row: {
  id: string;
  label: string;
  status: BacktestRunStatus;
  config: unknown;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  errorMessage: string | null;
}): BacktestRunSummary {
  return {
    id: row.id,
    label: row.label,
    status: row.status,
    config: row.config as BacktestRunConfig,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    errorMessage: row.errorMessage,
  };
}

export class InvalidBacktestRunConfigError extends Error {}

/**
 * Validates a user-supplied run request against real, documented resource
 * bounds (`constants.ts`) -- never a silent clamp: an out-of-bounds request
 * is rejected with an explicit reason, not quietly resized into something
 * the caller didn't ask for.
 */
function validateConfig(label: string, symbols: string[], windowDays: number): void {
  if (label.trim().length === 0) throw new InvalidBacktestRunConfigError("label must not be empty");
  if (label.length > MAX_RUN_LABEL_LENGTH) throw new InvalidBacktestRunConfigError(`label must be at most ${MAX_RUN_LABEL_LENGTH} characters`);

  const tradeableSymbols = [...new Set(symbols)].filter((s) => s !== BENCHMARK_SYMBOL);
  if (tradeableSymbols.length === 0) throw new InvalidBacktestRunConfigError("at least one tradeable symbol is required");
  if (tradeableSymbols.length > MAX_RUN_SYMBOLS) throw new InvalidBacktestRunConfigError(`at most ${MAX_RUN_SYMBOLS} tradeable symbols are allowed per run`);

  if (!Number.isInteger(windowDays) || windowDays < MIN_RUN_WINDOW_DAYS || windowDays > MAX_RUN_WINDOW_DAYS) {
    throw new InvalidBacktestRunConfigError(`windowDays must be an integer between ${MIN_RUN_WINDOW_DAYS} and ${MAX_RUN_WINDOW_DAYS}`);
  }
}

/**
 * Creates a `PENDING` `BacktestRun` row and enqueues the `run-backtest` job
 * to execute it (Sprint 21) -- reuses the existing BullMQ queue
 * infrastructure verbatim (`enqueue`, the same function every other job in
 * this codebase uses), never a second job system. Returns immediately; the
 * caller polls `getBacktestRun`/`listBacktestRuns` for progress, exactly
 * the same "enqueue now, read status later" shape every other async
 * operation in this codebase already uses (e.g. memory embedding
 * generation).
 */
export async function createBacktestRun(params: {
  organizationId: string;
  label: string;
  symbols: string[];
  windowDays: number;
  startingEquity?: number;
  requestedById?: string | null;
}): Promise<{ id: string }> {
  const { organizationId, label, symbols, windowDays, startingEquity, requestedById } = params;
  validateConfig(label, symbols, windowDays);

  const config: BacktestRunConfig = {
    symbols: [...new Set(symbols)],
    windowDays,
    startingEquity: startingEquity ?? DEFAULT_STARTING_EQUITY,
  };

  const scoped = getTenantScopedClient(organizationId);
  const run = await scoped.backtestRun.create({
    data: {
      organizationId,
      label: label.trim(),
      status: "PENDING",
      config: config as unknown as Prisma.InputJsonValue,
      requestedById: requestedById ?? null,
    },
    select: { id: true },
  });

  await enqueue("run-backtest", { backtestRunId: run.id, organizationId });

  return { id: run.id };
}

/** Tenant-scoped read of one run, including its full result once completed. `null` if the run doesn't exist or belongs to a different organization -- never throws for "not found," matching every other single-entity read in this codebase (e.g. `getStrategyEvaluation`'s own "not evaluated yet" non-throwing shape). */
export async function getBacktestRun(organizationId: string, runId: string): Promise<BacktestRunDetail | null> {
  const scoped = getTenantScopedClient(organizationId);
  const row = await scoped.backtestRun.findUnique({ where: { id: runId } });
  if (!row) return null;
  return { ...toSummary(row), result: row.result as unknown as BacktestReport | null };
}

/** Tenant-scoped, most-recent-first list of this organization's runs (summaries only -- omits `result` to keep the list cheap; call `getBacktestRun` for one run's full report). */
export async function listBacktestRuns(organizationId: string, limit = 20): Promise<BacktestRunSummary[]> {
  const scoped = getTenantScopedClient(organizationId);
  const rows = await scoped.backtestRun.findMany({
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, MAX_COMPARISON_RUNS * 2),
  });
  return rows.map(toSummary);
}

/** Re-exported so callers (the AI tool, tests) never need to import `@/server/db/tenant` directly just to catch this. */
export { CrossTenantAccessError };
