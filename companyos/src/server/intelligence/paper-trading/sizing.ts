import type { PaperPositionDirection, PaperPositionMode } from "@prisma/client";
import {
  LEVERAGE_TIERS,
  LIQUIDATION_SAFETY_MARGIN,
  MAX_STOP_PCT,
  MIN_STOP_PCT,
  RISK_PER_TRADE_PCT,
  SIMULATED_MAINTENANCE_MARGIN_RATE,
  STOP_VOLATILITY_MULTIPLIER,
  TAKE_PROFIT_REWARD_MULTIPLE,
} from "@/server/intelligence/paper-trading/constants";
import type { PaperEntryPlan } from "@/server/intelligence/paper-trading/types";

const clamp = (x: number, min: number, max: number): number => Math.max(min, Math.min(max, x));

/**
 * Derives a numeric stop distance (a fraction of entry price) from the
 * symbol's own observed volatility, since Sprint 15's `invalidationConditions`
 * are plain-language, never numeric (Sprint 16 Phase 10: "derive a
 * deterministic simulation rule and document it clearly ... do not
 * pretend the strategy supplied information it does not actually
 * contain"). Clamped to [`MIN_STOP_PCT`, `MAX_STOP_PCT`] so a near-zero or
 * extreme `volatilityPct` never produces a degenerate (0% or 100%+) stop.
 */
export function deriveStopDistancePct(volatilityPct: number): number {
  const raw = (volatilityPct * STOP_VOLATILITY_MULTIPLIER) / 100;
  return clamp(raw, MIN_STOP_PCT, MAX_STOP_PCT);
}

/**
 * SIMULATED_LIQUIDATION: an approximate, documented isolated-margin
 * liquidation formula -- explicitly NOT a reproduction of Binance's real
 * tiered maintenance-margin schedule (Sprint 16 Phase 12: "do not claim
 * to reproduce Binance's exact liquidation engine ... explicitly call it
 * SIMULATED_LIQUIDATION and document the assumptions"). Assumes: isolated
 * margin, no fees/funding drag included in the threshold itself (those
 * are tracked separately in P&L), and a flat maintenance-margin rate
 * (`SIMULATED_MAINTENANCE_MARGIN_RATE`) rather than Binance's real
 * position-size-tiered schedule. Returns `null` for `leverage <= 1`
 * (SPOT) -- spot positions are never liquidated in this simulation, the
 * same way a real spot holding isn't.
 */
export function computeSimulatedLiquidationPrice(entryPrice: number, leverage: number, direction: PaperPositionDirection): number | null {
  if (leverage <= 1) return null;
  const maintenanceBuffer = 1 / leverage - SIMULATED_MAINTENANCE_MARGIN_RATE;
  if (direction === "LONG") return entryPrice * (1 - maintenanceBuffer);
  return entryPrice * (1 + maintenanceBuffer);
}

function liquidationDistancePct(entryPrice: number, liquidationPrice: number | null): number {
  if (liquidationPrice === null) return Infinity;
  return Math.abs(entryPrice - liquidationPrice) / entryPrice;
}

/**
 * Walks `LEVERAGE_TIERS` from the confidence-selected tier DOWN (never up)
 * until the resulting `SIMULATED_LIQUIDATION` distance clears the stop
 * distance by `LIQUIDATION_SAFETY_MARGIN` -- so a normal stop-triggering
 * move can never accidentally liquidate the position first. Falls back to
 * 1x (SPOT, which has no liquidation at all) rather than skipping the
 * trade, since SPOT is always safe by construction. This is what makes
 * "leverage must be validated against explicit simulation constraints"
 * (Sprint 16 Phase 2) concrete and testable.
 */
export function selectSafeLeverage(confidence: number, direction: PaperPositionDirection, entryPrice: number, stopDistancePct: number): number {
  const candidateTier = LEVERAGE_TIERS.find((t) => confidence >= t.minConfidence) ?? LEVERAGE_TIERS[LEVERAGE_TIERS.length - 1]!;
  const tiersAtOrBelow = LEVERAGE_TIERS.filter((t) => t.leverage <= candidateTier.leverage).sort((a, b) => b.leverage - a.leverage);

  for (const tier of tiersAtOrBelow) {
    if (tier.leverage <= 1) return 1;
    const liquidationPrice = computeSimulatedLiquidationPrice(entryPrice, tier.leverage, direction);
    const distance = liquidationDistancePct(entryPrice, liquidationPrice);
    if (distance >= stopDistancePct * LIQUIDATION_SAFETY_MARGIN) return tier.leverage;
  }
  return 1;
}

/**
 * Risk-based position sizing (Sprint 16 Phase 9): `riskCapital = equity *
 * RISK_PER_TRADE_PCT` is the dollar amount the account is willing to lose
 * if the stop is hit; dividing that by the stop distance (in price terms)
 * gives the position quantity that makes that true regardless of
 * leverage -- leverage only changes how much MARGIN is required to hold
 * that notional, never how much is risked when the stop correctly fires.
 * `notional = riskCapital / stopDistancePct`, `requiredMargin =
 * notional / leverage`. Every intermediate value is returned so the
 * caller (and tests) can verify each step independently.
 */
export function computePositionSizing(
  equity: number,
  entryPrice: number,
  stopDistancePct: number,
  leverage: number,
): { quantity: number; notional: number; initialMargin: number; riskCapital: number } {
  const riskCapital = equity * RISK_PER_TRADE_PCT;
  const notional = riskCapital / stopDistancePct;
  const quantity = notional / entryPrice;
  const initialMargin = notional / leverage;
  return { quantity, notional, initialMargin, riskCapital };
}

/**
 * Builds the full, deterministic entry plan for a symbol: mode (`SPOT` iff
 * the safety-adjusted leverage is 1, `PERPETUAL_SIMULATION` otherwise),
 * leverage, stop/take-profit levels, position size, and (if applicable)
 * the simulated liquidation price. Pure function of already-known inputs
 * -- identical inputs always produce an identical plan.
 */
export function buildEntryPlan(params: {
  direction: PaperPositionDirection;
  entryPrice: number;
  volatilityPct: number;
  confidence: number;
  equity: number;
}): PaperEntryPlan {
  const { direction, entryPrice, volatilityPct, confidence, equity } = params;

  const stopDistancePct = deriveStopDistancePct(volatilityPct);
  const leverage = selectSafeLeverage(confidence, direction, entryPrice, stopDistancePct);
  const mode: PaperPositionMode = leverage <= 1 ? "SPOT" : "PERPETUAL_SIMULATION";

  const stopLossPrice = direction === "LONG" ? entryPrice * (1 - stopDistancePct) : entryPrice * (1 + stopDistancePct);
  const takeProfitDistancePct = stopDistancePct * TAKE_PROFIT_REWARD_MULTIPLE;
  const takeProfitPrice = direction === "LONG" ? entryPrice * (1 + takeProfitDistancePct) : entryPrice * (1 - takeProfitDistancePct);

  const { quantity, notional, initialMargin } = computePositionSizing(equity, entryPrice, stopDistancePct, leverage);
  const liquidationPrice = mode === "SPOT" ? null : computeSimulatedLiquidationPrice(entryPrice, leverage, direction);

  return { direction, mode, leverage, entryPrice, quantity, notional, initialMargin, stopLossPrice, takeProfitPrice, liquidationPrice };
}
