/**
 * Sprint 20's own deterministic backtest parameters, named and documented
 * (the same "every threshold/formula gets a name and a reason, never a bare
 * magic number" discipline `paper-trading/constants.ts` and
 * `market-decision/constants.ts` already established). Every REAL indicator
 * window this sprint needs (warmup) is imported from the exact Sprint 13/14
 * constants the live pipeline already uses -- never a second, independently
 * chosen number that could silently drift from what production actually
 * requires.
 */

import { DAILY_INTERVAL, DAILY_WINDOW, MEDIUM_WINDOW, SHORT_INTERVAL, SHORT_WINDOW } from "@/server/market-data/types";

export { DAILY_INTERVAL, SHORT_INTERVAL };

/**
 * How many DAILY-interval (1h) candles must exist, in order, before the
 * replay engine can compute its first `MarketMetrics` -- exactly
 * `computeMarketMetrics`'s own hard requirement (`market-metrics.ts`:
 * "Requires the FULL requested window ... a partial candle history ...
 * returns `null`"). Re-derived here by reference, never re-guessed:
 * `MEDIUM_WINDOW` is already a strict subset of the same `DAILY_WINDOW`
 * fetch (the live pipeline's own comment: "last 12 of the same daily fetch,
 * no extra call"), so it adds no additional warmup requirement of its own.
 */
export const WARMUP_DAILY_CANDLES = DAILY_WINDOW;
export const WARMUP_SHORT_CANDLES = SHORT_WINDOW;

/** Sanity self-check, not a redefinition -- fails loudly at import time if `market-data/types.ts` ever changes this relationship without this module being revisited. */
if (MEDIUM_WINDOW > DAILY_WINDOW) {
  throw new Error("backtest warmup assumption violated: MEDIUM_WINDOW must never exceed DAILY_WINDOW");
}

/**
 * Real-world duration one replay step covers -- exactly `DAILY_INTERVAL`'s
 * own cadence (1 hour), matching how often `ingest-market-data` /
 * `generate-market-intelligence` / `generate-market-strategies` /
 * `evaluate-paper-trading` actually run in production. A backtest step is
 * "what would this hourly pipeline pass have done," never a finer or
 * coarser granularity than what the live system itself operates at.
 */
export const STEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Sprint 20 Phase 12 (walk-forward / out-of-sample split): a single,
 * documented, non-optimized chronological split point -- 70% of REPLAY
 * STEPS (never trades, which would already be look-ahead-tainted by
 * construction) for the "in-sample" period, the remaining 30% held out as
 * "out-of-sample." Not tuned against any result; a simple, standard,
 * explainable default.
 */
export const WALK_FORWARD_TRAIN_RATIO = 0.7;

/**
 * The Backtest Quality/Robustness score (Phase 14) reuses the EXACT same
 * minimum-evidence gate `decision-intelligence/sample-safety.ts#MIN_SAMPLE_SIZE`
 * already established for every other "do we have enough evidence" check in
 * this codebase (Sprint 12/17/18) -- never a second, backtest-specific
 * threshold invented for this one score.
 */
export { MIN_SAMPLE_SIZE } from "@/server/intelligence/decision-intelligence/sample-safety";

/** Maximum number of per-symbol-per-step decisions retained in a run's `decisionTrace` (Phase 21/22 auditability) -- bounded so a long backtest over many symbols never returns an unbounded in-memory array. Callers that need the full trace for a short, targeted test run stay well under this. */
export const MAX_DECISION_TRACE_ENTRIES = 5000;

/**
 * Sprint 21: bounds on a user-launched, persisted `BacktestRun` request --
 * a real resource/cost ceiling (each additional symbol is 2 more real
 * Binance klines fetches, each additional day is more warmup/replay work),
 * not a modeling constant. `MAX_RUN_SYMBOLS` deliberately excludes
 * `BENCHMARK_SYMBOL` from the count (it's always fetched regardless of
 * whether the caller lists it -- see `historical-data.ts`'s own
 * unconditional benchmark inclusion), so a request for `MAX_RUN_SYMBOLS`
 * tradeable symbols still only ever means `MAX_RUN_SYMBOLS + 1` total
 * series fetched.
 */
export const MAX_RUN_SYMBOLS = 5;
export const MIN_RUN_WINDOW_DAYS = 1;
export const MAX_RUN_WINDOW_DAYS = 90;
export const MAX_RUN_LABEL_LENGTH = 120;

/**
 * Sprint 21 Phase (multi-run comparison): the maximum number of persisted
 * `BacktestRun` rows a single comparison call will read at once -- bounded
 * for the same reason `MAX_DECISION_TRACE_ENTRIES` is: a comparison view is
 * meant to be read by a human, not an unbounded report.
 */
export const MAX_COMPARISON_RUNS = 10;
