import type { PaperPositionDirection, PaperPositionMode, PaperPositionStatus } from "@prisma/client";
import { computeFee, computeFundingCost, computeGrossPnl, computeNetPnl } from "@/server/intelligence/paper-trading/pnl";

export type OpenPositionState = {
  direction: PaperPositionDirection;
  mode: PaperPositionMode;
  entryPrice: number;
  quantity: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  liquidationPrice: number | null;
  feesPaidSoFar: number;
  fundingPaidSoFar: number;
  maxFavorableExcursion: number;
  maxAdverseExcursion: number;
  lastFundingAt: Date;
};

export type PositionUpdateResult = {
  currentPrice: number;
  grossPnl: number;
  fundingChargeThisRun: number;
  fundingPaidTotal: number;
  feesPaidTotal: number;
  /** Net P&L at `currentPrice` -- unrealized while staying OPEN, becomes `realizedPnl` verbatim the moment `closeStatus` is non-null (the exit fee is already included). */
  netPnl: number;
  maxFavorableExcursion: number;
  maxAdverseExcursion: number;
  closeStatus: Extract<PaperPositionStatus, "STOPPED" | "TAKE_PROFIT" | "LIQUIDATED" | "INVALIDATED"> | null;
};

/**
 * One deterministic evaluation step for an OPEN position: marks it to
 * `currentPrice`, accrues funding (Sprint 16 Phase 14, `PERPETUAL_SIMULATION`
 * only), updates the running favorable/adverse excursion, and checks the
 * four close conditions in a fixed, documented priority order --
 * `LIQUIDATED` first (most margin-critical), then `STOPPED`, then
 * `TAKE_PROFIT`, then `INVALIDATED` (the strategy's own thesis no longer
 * holds this run), else the position stays `OPEN`. Pure function of its
 * inputs -- identical inputs always produce an identical result (Phase 31:
 * idempotency / deterministic replay).
 */
export function evaluatePositionUpdate(
  state: OpenPositionState,
  currentPrice: number,
  now: Date,
  thesisInvalidated: boolean,
): PositionUpdateResult {
  const elapsedHours = Math.max(0, (now.getTime() - state.lastFundingAt.getTime()) / 3_600_000);
  const notional = state.quantity * state.entryPrice;
  const fundingChargeThisRun = state.mode === "PERPETUAL_SIMULATION" ? computeFundingCost(notional, elapsedHours) : 0;
  const fundingPaidTotal = state.fundingPaidSoFar + fundingChargeThisRun;

  const grossPnl = computeGrossPnl(state.direction, state.entryPrice, currentPrice, state.quantity);
  const unrealizedNetPnl = computeNetPnl(grossPnl, state.feesPaidSoFar, fundingPaidTotal);

  const maxFavorableExcursion = Math.max(state.maxFavorableExcursion, unrealizedNetPnl);
  const maxAdverseExcursion = Math.min(state.maxAdverseExcursion, unrealizedNetPnl);

  const closeStatus = detectCloseStatus(state, currentPrice, thesisInvalidated);

  if (!closeStatus) {
    return {
      currentPrice,
      grossPnl,
      fundingChargeThisRun,
      fundingPaidTotal,
      feesPaidTotal: state.feesPaidSoFar,
      netPnl: unrealizedNetPnl,
      maxFavorableExcursion,
      maxAdverseExcursion,
      closeStatus: null,
    };
  }

  // Closing: the exit trade also pays PAPER_FEE_RATE, at the closing notional.
  const exitFee = computeFee(state.quantity * currentPrice);
  const feesPaidTotal = state.feesPaidSoFar + exitFee;
  const realizedNetPnl = computeNetPnl(grossPnl, feesPaidTotal, fundingPaidTotal);

  return {
    currentPrice,
    grossPnl,
    fundingChargeThisRun,
    fundingPaidTotal,
    feesPaidTotal,
    netPnl: realizedNetPnl,
    maxFavorableExcursion: Math.max(maxFavorableExcursion, realizedNetPnl),
    maxAdverseExcursion: Math.min(maxAdverseExcursion, realizedNetPnl),
    closeStatus,
  };
}

function detectCloseStatus(
  state: OpenPositionState,
  currentPrice: number,
  thesisInvalidated: boolean,
): PositionUpdateResult["closeStatus"] {
  if (state.liquidationPrice !== null) {
    const liquidated = state.direction === "LONG" ? currentPrice <= state.liquidationPrice : currentPrice >= state.liquidationPrice;
    if (liquidated) return "LIQUIDATED";
  }

  const stopped = state.direction === "LONG" ? currentPrice <= state.stopLossPrice : currentPrice >= state.stopLossPrice;
  if (stopped) return "STOPPED";

  const tookProfit = state.direction === "LONG" ? currentPrice >= state.takeProfitPrice : currentPrice <= state.takeProfitPrice;
  if (tookProfit) return "TAKE_PROFIT";

  if (thesisInvalidated) return "INVALIDATED";

  return null;
}
