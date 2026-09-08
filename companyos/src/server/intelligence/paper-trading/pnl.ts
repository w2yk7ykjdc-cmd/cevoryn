import type { PaperPositionDirection } from "@prisma/client";
import { FUNDING_INTERVAL_HOURS, PAPER_FEE_RATE, PAPER_FUNDING_RATE_PER_8H } from "@/server/intelligence/paper-trading/constants";

/**
 * Gross P&L (Sprint 16 Phase 7/15) -- before fees/funding. LONG profits
 * when price rises, SHORT profits when price falls; both are the same
 * `quantity * priceDelta` shape with the sign flipped by direction, so the
 * two are exact mirror images of each other by construction (tested
 * directly as "long vs short symmetry").
 */
export function computeGrossPnl(direction: PaperPositionDirection, entryPrice: number, currentPrice: number, quantity: number): number {
  const priceDelta = direction === "LONG" ? currentPrice - entryPrice : entryPrice - currentPrice;
  return priceDelta * quantity;
}

/** PAPER_FEE_RATE applied to a notional -- see `constants.ts` for why this is never claimed to be the user's real Binance fee tier. */
export function computeFee(notional: number): number {
  return notional * PAPER_FEE_RATE;
}

/**
 * Simulated funding cost (Sprint 16 Phase 14), prorated by elapsed hours
 * since the position (or its last funding charge) was last evaluated over
 * the `FUNDING_INTERVAL_HOURS` (8h) interval. Zero for `SPOT` positions
 * (real spot holdings have no funding). Always a cost against P&L in this
 * simplified model -- long/short funding-rate asymmetry is not modeled,
 * a documented simplification (see `constants.ts`).
 */
export function computeFundingCost(notional: number, elapsedHours: number): number {
  if (elapsedHours <= 0) return 0;
  return notional * PAPER_FUNDING_RATE_PER_8H * (elapsedHours / FUNDING_INTERVAL_HOURS);
}

/**
 * Net P&L (Sprint 16 Phase 15): gross minus fees minus funding -- costs
 * are never hidden or netted away silently; each component is tracked
 * and returned independently so a caller can display "gross / fees /
 * funding / net" exactly as the spec requires.
 */
export function computeNetPnl(grossPnl: number, feesPaid: number, fundingPaid: number): number {
  return grossPnl - feesPaid - fundingPaid;
}

/** Return on MARGIN (not on notional) -- the standard leveraged-return convention: this is what the simulated equity actually gained/lost, since `initialMargin` (not `notional`) is what was "put up." */
export function computeReturnPct(netPnl: number, initialMargin: number): number {
  if (initialMargin <= 0) return 0;
  return netPnl / initialMargin;
}
