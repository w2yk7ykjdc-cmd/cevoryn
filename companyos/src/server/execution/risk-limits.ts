import { MAX_SIMULTANEOUS_POSITIONS, MAX_TOTAL_EXPOSURE_MULTIPLE } from "@/server/intelligence/paper-trading/constants";

/**
 * Sprint 22 Phase 8: hard, deterministic LIVE-execution risk limits --
 * reuses Sprint 16/19's own exposure/position-count ceilings
 * (`MAX_TOTAL_EXPOSURE_MULTIPLE`/`MAX_SIMULTANEOUS_POSITIONS`) as the
 * FLOOR, then adds several genuinely NEW limits this sprint's own spec
 * calls for that have no paper-trading equivalent (paper has no real
 * money to lose, so "max daily loss"/"max consecutive losses"/"emergency
 * stop" are meaningless there). Every constant here is a plain, named,
 * hardcoded value -- never read from a database row, never something an
 * LLM/AI tool call can see a code path to modify (Phase 15's own explicit
 * "LLM bu limitleri değiştiremez").
 *
 * These are DELIBERATELY STRICTER than their paper/simulation
 * counterparts, matching Sprint 19's own established pattern (execution-
 * level checks are always a stricter bar than the strategy layer's).
 */

/** Live leverage ceiling -- well below `paper-trading/constants.ts#MAX_SIMULATION_LEVERAGE` (10x): real capital, real liquidation risk, a conservative starting ceiling. */
export const MAX_LIVE_LEVERAGE = 3;

/** A single order's notional (quantity * price) may never exceed this fraction of current account equity -- bounds the blast radius of any ONE order regardless of how position-count/total-exposure limits are computed. */
export const MAX_ORDER_NOTIONAL_PCT_OF_EQUITY = 0.1;

/** Live-specific: never lets total exposure exceed this MULTIPLE of equity -- reuses the same shape as `MAX_TOTAL_EXPOSURE_MULTIPLE` but a lower ceiling for real capital. */
export const MAX_LIVE_TOTAL_EXPOSURE_MULTIPLE = Math.min(2, MAX_TOTAL_EXPOSURE_MULTIPLE);

/** Live-specific: never more open positions at once than this -- reuses the same shape as `MAX_SIMULTANEOUS_POSITIONS` but a lower ceiling. */
export const MAX_LIVE_SIMULTANEOUS_POSITIONS = Math.min(3, MAX_SIMULTANEOUS_POSITIONS);

/** No single symbol may account for more than this fraction of total account equity in open notional -- a real, additional diversification floor beyond the aggregate exposure limit above. */
export const MAX_SYMBOL_EXPOSURE_PCT_OF_EQUITY = 0.3;

/** No single strategy type may account for more than this fraction of total account equity in open notional -- guards against one flawed strategy type dominating the whole account. */
export const MAX_STRATEGY_EXPOSURE_PCT_OF_EQUITY = 0.5;

/** If today's realized loss reaches this fraction of the account's starting-of-day equity, no new entries are allowed for the rest of the day (existing positions are unaffected -- same "stop new risk, never freeze existing risk" principle the kill switch itself applies). */
export const MAX_DAILY_LOSS_PCT = 0.05;

/** After this many consecutive losing closed trades (for LIVE positions), no new entries are allowed until a human explicitly re-enables entries -- a real, automatic circuit breaker against a strategy that has started failing in a way backtesting/paper trading never predicted. */
export const MAX_CONSECUTIVE_LOSSES = 3;

/**
 * Sprint 23 Phase 3: the "risk limits configured" readiness check --
 * verifies every hard limit this module defines is a positive, finite
 * number (never zero, negative, `NaN`, or `Infinity`), so a future code
 * change that accidentally undefines or breaks a constant is caught by
 * `checkLiveModeReadiness` BEFORE it could ever let a limit silently stop
 * applying. Pure, deterministic, and independent of any organization or
 * gateway -- these constants are the same for every organization by
 * design (Phase 15's own "LLM bu limitleri değiştiremez").
 */
/** Pure, unit-testable core: `true` only if every value is finite and positive. Separated from `areRiskLimitsConfigured()` so a test can exercise the FALSE branch (a hypothetical broken constant) without needing this codebase's own real, always-valid constants to ever actually be broken. */
export function computeRiskLimitsConfigured(values: number[]): boolean {
  return values.length > 0 && values.every((v) => Number.isFinite(v) && v > 0);
}

export function areRiskLimitsConfigured(): boolean {
  return computeRiskLimitsConfigured([
    MAX_LIVE_LEVERAGE,
    MAX_ORDER_NOTIONAL_PCT_OF_EQUITY,
    MAX_LIVE_TOTAL_EXPOSURE_MULTIPLE,
    MAX_LIVE_SIMULTANEOUS_POSITIONS,
    MAX_SYMBOL_EXPOSURE_PCT_OF_EQUITY,
    MAX_STRATEGY_EXPOSURE_PCT_OF_EQUITY,
    MAX_DAILY_LOSS_PCT,
    MAX_CONSECUTIVE_LOSSES,
  ]);
}

export type RiskLimitViolation =
  | "max_order_notional"
  | "max_leverage"
  | "max_total_exposure"
  | "max_open_positions"
  | "max_symbol_exposure"
  | "max_strategy_exposure"
  | "max_daily_loss"
  | "max_consecutive_losses"
  | "emergency_stop";

export type RiskLimitCheckInput = {
  orderNotional: number;
  leverage: number;
  accountEquity: number;
  existingTotalExposure: number;
  existingOpenPositionCount: number;
  existingSymbolExposure: number;
  existingStrategyExposure: number;
  todaysRealizedLossPct: number;
  consecutiveLosses: number;
  emergencyStopEngaged: boolean;
};

/**
 * Checks every hard limit in a fixed, documented order and returns the
 * FIRST violation (matching `paper-trading/entry.ts#decideEntry`'s and
 * `market-decision/service.ts#validateProposedOrder`'s own established
 * "first failure wins, deterministic" style) -- `null` when every limit is
 * satisfied. Pure function, zero I/O, trivially unit-testable and
 * impossible for an LLM to influence at runtime (it only ever sees
 * already-computed numbers, never a prompt-controllable threshold).
 */
export function checkRiskLimits(input: RiskLimitCheckInput): RiskLimitViolation | null {
  if (input.emergencyStopEngaged) return "emergency_stop";
  if (input.consecutiveLosses >= MAX_CONSECUTIVE_LOSSES) return "max_consecutive_losses";
  if (input.todaysRealizedLossPct >= MAX_DAILY_LOSS_PCT) return "max_daily_loss";
  if (input.leverage > MAX_LIVE_LEVERAGE) return "max_leverage";
  if (input.accountEquity > 0 && input.orderNotional / input.accountEquity > MAX_ORDER_NOTIONAL_PCT_OF_EQUITY) return "max_order_notional";
  if (input.existingOpenPositionCount >= MAX_LIVE_SIMULTANEOUS_POSITIONS) return "max_open_positions";
  if (input.accountEquity > 0 && (input.existingTotalExposure + input.orderNotional) / input.accountEquity > MAX_LIVE_TOTAL_EXPOSURE_MULTIPLE) return "max_total_exposure";
  if (input.accountEquity > 0 && (input.existingSymbolExposure + input.orderNotional) / input.accountEquity > MAX_SYMBOL_EXPOSURE_PCT_OF_EQUITY) return "max_symbol_exposure";
  if (input.accountEquity > 0 && (input.existingStrategyExposure + input.orderNotional) / input.accountEquity > MAX_STRATEGY_EXPOSURE_PCT_OF_EQUITY) return "max_strategy_exposure";
  return null;
}
