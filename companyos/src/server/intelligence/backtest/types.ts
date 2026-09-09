import type { PaperPositionDirection, PaperPositionMode, PaperPositionStatus } from "@prisma/client";
import type { Candle } from "@/server/market-data/types";
import type { MarketDecision } from "@/server/intelligence/market-decision/types";

/**
 * One symbol's real historical OHLCV history at ONE of the two timeframes
 * the live pipeline itself uses (`DAILY_INTERVAL`="1h", `SHORT_INTERVAL`="15m"
 * -- see `market-data/types.ts`). MUST be in strictly ascending
 * `closeTime` order with no gaps the caller is aware of -- the replay
 * engine trusts this ordering to slice "as of" windows correctly (Phase 3);
 * it does not itself re-sort or de-duplicate. Every candle is the same
 * `Candle` shape Sprint 13 already defined (original decimal strings,
 * never lossily converted) -- Sprint 20 introduces NO new candle type.
 */
export type HistoricalSymbolCandles = {
  daily: Candle[];
  short: Candle[];
};

/** Every symbol's historical series this backtest run has been given, keyed by symbol. */
export type HistoricalDataset = Record<string, HistoricalSymbolCandles>;

export type BacktestConfig = {
  /**
   * Tenant this run is attributed to. The pure replay engine (`engine.ts`)
   * never queries the database at all (see its own doc comment) so this
   * field is never used to scope a Prisma call inside the engine -- it
   * exists purely so an outer API/UI layer can label, authorize, and log a
   * run per-organization (Phase 19), exactly the way `organizationId` is
   * threaded through every other tenant-scoped service in this codebase.
   */
  organizationId: string;
  /**
   * The explicit, caller-specified tradeable universe for this run --
   * deliberately NEVER `discoverMarketUniverse`'s dynamic, CURRENT-liquidity
   * ranking (Sprint 14). Reusing that function here would silently
   * re-introduce look-ahead bias of a subtler kind: "today's" top-30 most
   * liquid symbols is not the same set that would have been discoverable
   * ranked-by-liquidity on every historical date being replayed, and
   * Binance's `ticker/24hr` endpoint has no historical mode at all. A fixed,
   * caller-chosen universe is honest about what it is: "replay THESE
   * symbols over this historical window," never a claim about what a
   * dynamic scanner would have surfaced on each past date.
   */
  symbols: string[];
  /** This run's real historical candle data. `BENCHMARK_SYMBOL`'s own series is required (added by the caller, or the service throws) since regime classification and relative strength need it unconditionally, exactly like the live pipeline. */
  dataset: HistoricalDataset;
  /** PAPER/SIMULATION ONLY -- see `paper-trading/constants.ts#DEFAULT_STARTING_EQUITY`. Defaults to that same constant, never a second, independently-chosen starting balance. */
  startingEquity?: number;
};

/** A fully closed simulated trade -- the exact same fields `PaperTrade` records in production (see `prisma/schema.prisma#PaperTrade`), computed by the SAME reused pnl/sizing functions, but held only in memory for this run's result -- never written to the real `PaperTrade` table (Phase 8/17/20). */
export type BacktestTrade = {
  symbol: string;
  direction: PaperPositionDirection;
  mode: PaperPositionMode;
  strategyType: string;
  regime: string | null;
  candidateScore: number;
  candidateConfidence: number;
  leverage: number;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  notional: number;
  initialMargin: number;
  grossPnl: number;
  feesPaid: number;
  fundingPaid: number;
  netPnl: number;
  returnPct: number;
  maxFavorableExcursion: number;
  maxAdverseExcursion: number;
  closeReason: Extract<PaperPositionStatus, "STOPPED" | "TAKE_PROFIT" | "LIQUIDATED" | "INVALIDATED">;
  openedAt: string;
  closedAt: string;
};

/** In-memory mirror of `paper-trading/evaluate.ts#OpenPositionState`, plus the identifying fields a real `PaperPosition` row also carries -- never a real DB row (Phase 8). */
export type BacktestOpenPosition = {
  symbol: string;
  direction: PaperPositionDirection;
  mode: PaperPositionMode;
  strategyType: string;
  regime: string | null;
  candidateScore: number;
  candidateConfidence: number;
  leverage: number;
  entryPrice: number;
  quantity: number;
  notional: number;
  initialMargin: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  liquidationPrice: number | null;
  feesPaidSoFar: number;
  fundingPaidSoFar: number;
  /** This position's current mark-to-market net P&L (Phase 8/9) -- the exact same quantity `PaperPosition.unrealizedPnl` tracks in production, aggregated into `BacktestAccountState.unrealizedPnl` at the end of every replay step. */
  unrealizedPnl: number;
  maxFavorableExcursion: number;
  maxAdverseExcursion: number;
  lastFundingAt: Date;
  openedAt: Date;
};

/** In-memory mirror of `paper-trading/account.ts#PaperAccountView` -- never the real `PaperAccount` row (Phase 8/17/20: this backtest's own account state is isolated and never mutates the organization's real paper-trading account). */
export type BacktestAccountState = {
  startingEquity: number;
  currentEquity: number;
  peakEquity: number;
  usedMargin: number;
  unrealizedPnl: number;
  realizedPnl: number;
  totalFees: number;
  totalFunding: number;
};

export type BacktestAccountView = BacktestAccountState & { availableMargin: number; drawdownPct: number };

/** One symbol's full decision at one replay step -- the SAME `MarketDecision` shape Sprint 19 already defined, kept for full auditability (Phase 21's look-ahead tests read this trace directly) and clearly labeled by `stepTime`/`asOfIso` as historical/hypothetical, never a live decision. */
export type BacktestDecisionTraceEntry = {
  stepIndex: number;
  stepTime: string;
  symbol: string;
  decision: MarketDecision;
};

export type BacktestRunResult = {
  organizationId: string;
  symbols: string[];
  stepsProcessed: number;
  firstStepTime: string | null;
  lastStepTime: string | null;
  finalAccount: BacktestAccountView;
  closedTrades: BacktestTrade[];
  openPositionsAtEnd: BacktestOpenPosition[];
  decisionTrace: BacktestDecisionTraceEntry[];
  /** `true` when `decisionTrace` was truncated at `MAX_DECISION_TRACE_ENTRIES` -- never silently dropped without saying so. */
  decisionTraceTruncated: boolean;
};
