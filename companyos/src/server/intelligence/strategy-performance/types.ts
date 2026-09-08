import type { SampleSizeStatus } from "@/server/intelligence/decision-intelligence/types";

export type { SampleSizeStatus };

/**
 * Deterministic, DB-derived performance measurement over closed
 * `PaperTrade` rows (Sprint 17 Phase 4). Every trade counted here is a
 * SIMULATED paper trade -- never real money, never a real Binance fill.
 * `winningTrades`/`losingTrades`/`neutralTrades` are derived from the
 * `Outcome` this trade's own `paper_trade_result.v1` evaluation produced
 * (`success` -> win, `failure`/`reversed` -> loss, `neutral`/`expired` ->
 * neutral), never re-derived from a different threshold here -- one
 * classification, reused everywhere, never two competing definitions of
 * "did this trade win."
 */
export type StrategyPerformanceMetrics = {
  totalTrades: number;
  evaluatedTrades: number;
  winningTrades: number;
  losingTrades: number;
  neutralTrades: number;
  winRate: number | null;
  lossRate: number | null;
  averageReturnPct: number | null;
  medianReturnPct: number | null;
  totalRealizedPnl: number;
  averagePnl: number | null;
  bestTradePnl: number | null;
  worstTradePnl: number | null;
  averageHoldingDurationMs: number | null;
  liquidationCount: number;
  stopLossCount: number;
  takeProfitCount: number;
  invalidationCount: number;
  totalFees: number;
  totalFunding: number;
  /** Laplace-shrunk win rate (reuses `decision-intelligence/sample-safety.ts#shrinkSuccessRate` verbatim) -- never a raw win rate presented as if it were statistically proven at low sample sizes. */
  shrunkWinRate: number;
  sampleSizeStatus: SampleSizeStatus;
};

export type StrategyTypePerformance = {
  strategyType: string;
  performance: StrategyPerformanceMetrics;
};

export type RegimePerformance = {
  strategyType: string;
  regime: string;
  performance: StrategyPerformanceMetrics;
};

export type SymbolPerformance = {
  symbol: string;
  performance: StrategyPerformanceMetrics;
};

export type DirectionPerformance = {
  direction: "LONG" | "SHORT";
  performance: StrategyPerformanceMetrics;
};

export type LeverageTierPerformance = {
  leverage: number;
  performance: StrategyPerformanceMetrics;
};

export type ConfidenceCalibrationBucket = {
  label: string;
  min: number;
  max: number;
  totalEvaluated: number;
  successCount: number;
  observedSuccessRate: number | null;
};

/**
 * One closed `PaperTrade` plus the `outcomeType` its `paper_trade_result.v1`
 * evaluation produced (Sprint 17 Phase 12's "Paper Trading Outcomes"
 * section) -- `outcomeResult: null` means the hourly evaluation pass hasn't
 * reached it yet, never a fabricated verdict. Always PAPER/SIMULATION only.
 */
export type PaperTradeOutcomeRow = {
  id: string;
  symbol: string;
  strategyType: string;
  direction: "LONG" | "SHORT";
  mode: "SPOT" | "PERPETUAL_SIMULATION";
  regime: string | null;
  closeReason: string;
  returnPct: number;
  netPnl: number;
  leverage: number;
  closedAt: string;
  outcomeResult: string | null;
};
