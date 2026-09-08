import type { PaperPositionDirection, PaperPositionMode, PaperPositionStatus } from "@prisma/client";
import type { MarketMetricsSnapshotPayload, StrategyCandidate } from "@/server/intelligence/strategy/types";

export type { PaperPositionDirection, PaperPositionMode, PaperPositionStatus, StrategyCandidate, MarketMetricsSnapshotPayload };

/** Every closed reason that is NOT a still-active status -- `OPEN`/`PENDING` are the only non-terminal states. */
export const TERMINAL_STATUSES: ReadonlySet<PaperPositionStatus> = new Set(["CLOSED", "STOPPED", "TAKE_PROFIT", "LIQUIDATED", "INVALIDATED"]);

/**
 * Everything one evaluation pass needs to decide entry/update/close for a
 * single symbol -- assembled purely from already-persisted data (the
 * `market_strategy_candidate.v1` and `market_metrics_snapshot.v1`
 * `CompanySignal` rows for this symbol, plus the org's own `PaperAccount`
 * and any existing open `PaperPosition`), never a fresh Binance call.
 */
export type SymbolEvaluationInput = {
  symbol: string;
  candidate: StrategyCandidate;
  metrics: MarketMetricsSnapshotPayload;
  strategySignalId: string | null;
};

/** Why entry was skipped this run -- always present when no position was opened for a symbol whose strategy is not `NO_TRADE`, so "why didn't it trade?" is always answerable, mirroring `NoTradeReason`'s own explainability discipline. */
export type EntrySkipReason =
  | "no_trade_strategy"
  | "no_direction"
  | "stale_data"
  | "already_open"
  | "insufficient_margin"
  | "max_positions_reached"
  | "max_exposure_reached";

export type EntryDecision =
  | { opened: true }
  | { opened: false; reason: EntrySkipReason };

/** The deterministic sizing/leverage/stop/take-profit/liquidation plan for one entry -- computed once, then persisted verbatim onto the new `PaperPosition`. Every field here is SIMULATED; see `sizing.ts` for the documented formula behind each one. */
export type PaperEntryPlan = {
  direction: PaperPositionDirection;
  mode: PaperPositionMode;
  leverage: number;
  entryPrice: number;
  quantity: number;
  notional: number;
  initialMargin: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  liquidationPrice: number | null;
};
