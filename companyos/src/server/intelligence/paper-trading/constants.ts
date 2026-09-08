/**
 * Every deterministic simulation parameter the Paper Trading Engine uses,
 * named and documented (Sprint 16's own explicit requirement: "document
 * every threshold / formula"). Nothing here is inferred from a real
 * account, a real balance, or a real Binance fee/funding tier -- every
 * value is an explicit, labeled SIMULATION input. See the project
 * README's "Leveraged Paper Trading Engine" section for the worked
 * formulas these constants feed.
 */

/** PAPER/SIMULATION ONLY -- never a real balance. The default virtual starting equity for a newly-created `PaperAccount`, in USDT-equivalent simulation units. */
export const DEFAULT_STARTING_EQUITY = 10_000;

/**
 * Fraction of current equity risked on a single position's stop distance
 * (the standard "risk-based position sizing" convention: how much you're
 * willing to lose if the stop is hit, not how much capital is deployed).
 * 1% is a conservative, commonly-documented starting point for leveraged
 * simulation -- not derived from a backtest, the same "reasonable,
 * explainable starting point" spirit every other threshold in this
 * codebase already uses.
 */
export const RISK_PER_TRADE_PCT = 0.01;

/**
 * Leverage tiers (Sprint 16 Phase 8: "do NOT hardcode one leverage level
 * as the only possibility"). Deterministically selected from the
 * strategy candidate's own `confidence` (never randomly, never by an
 * LLM) -- higher-confidence theses get a higher leverage tier, checked in
 * descending order. `MAX_SIMULATION_LEVERAGE` (10x) is a documented
 * simulation ceiling matching the sprint spec's own worked example range
 * (1x/2x/3x/5x/10x), not a claim about what any real exchange allows.
 */
export const LEVERAGE_TIERS: ReadonlyArray<{ minConfidence: number; leverage: number }> = [
  { minConfidence: 90, leverage: 10 },
  { minConfidence: 80, leverage: 5 },
  { minConfidence: 70, leverage: 3 },
  { minConfidence: 60, leverage: 2 },
  { minConfidence: 0, leverage: 1 },
];
export const MAX_SIMULATION_LEVERAGE = 10;

/**
 * Before opening a leveraged position, the engine requires the stop
 * distance to sit safely inside the liquidation distance -- otherwise a
 * normal stop-triggering move could liquidate the position before the
 * stop can act, which would silently misrepresent the simulated risk.
 * `LIQUIDATION_SAFETY_MARGIN` (20% buffer) is the documented margin of
 * safety required between the two; if no leverage tier satisfies it, the
 * engine steps down to the next tier, defaulting to 1x (SPOT, which has
 * no liquidation at all) rather than skipping the trade -- see
 * `sizing.ts#selectSafeLeverage`.
 */
export const LIQUIDATION_SAFETY_MARGIN = 1.2;

/** Approximate, documented isolated-margin maintenance rate used only by `SIMULATED_LIQUIDATION` (see `sizing.ts`) -- explicitly NOT a reproduction of Binance's real tiered maintenance-margin schedule. */
export const SIMULATED_MAINTENANCE_MARGIN_RATE = 0.005;

/** Stop distance = `volatilityPct * STOP_VOLATILITY_MULTIPLIER`, clamped to [`MIN_STOP_PCT`, `MAX_STOP_PCT`] -- see `sizing.ts#deriveStopDistancePct`. Sprint 15's `invalidationConditions` are plain-language, not numeric, so this is the documented, explicit simulation rule that derives an actual price level from the same volatility evidence the strategy itself was built on. */
export const STOP_VOLATILITY_MULTIPLIER = 1.5;
export const MIN_STOP_PCT = 0.01;
export const MAX_STOP_PCT = 0.1;

/** Take-profit distance = stop distance * this reward:risk multiple (2:1) -- a labeled simulation parameter, never a predicted or guaranteed profit. */
export const TAKE_PROFIT_REWARD_MULTIPLE = 2;

/** PAPER_FEE_RATE: a round-trip (charged on both open and close) simulated trading fee, matching a typical taker-fee magnitude -- explicitly NOT the user's real Binance fee tier. */
export const PAPER_FEE_RATE = 0.0004;

/** PAPER_FUNDING_RATE: a simulated per-8h funding rate charged only to `PERPETUAL_SIMULATION` positions, prorated by elapsed time since the position (or its last funding charge) was last evaluated. Explicitly a simulation input, never live Binance funding data -- see Sprint 16 Phase 14's own "use an explicit simulation input rather than pretending it is Binance's live funding rate." Applied as a flat cost to whichever side is open (long/short funding asymmetry is not modeled), documented here as a deliberate simplification. */
export const PAPER_FUNDING_RATE_PER_8H = 0.0001;
export const FUNDING_INTERVAL_HOURS = 8;

/** Maximum number of paper positions open at once, per organization -- a portfolio-level risk control (Sprint 16 Phase 22/23), not an autonomy control. */
export const MAX_SIMULTANEOUS_POSITIONS = 5;

/** Maximum total open notional exposure, as a multiple of current equity -- caps aggregate leveraged exposure across the whole simulated portfolio, independent of any single position's own leverage. */
export const MAX_TOTAL_EXPOSURE_MULTIPLE = 5;

/** How stale a `market_metrics_snapshot.v1` (and therefore its paired `market_strategy_candidate.v1`) may be before the paper engine refuses to act on it for BOTH entry and price updates -- reuses the exact same constant Sprint 15's own strategy engine already enforces (`strategy/scoring.ts#STALE_DATA_MAX_AGE_MS`), imported directly rather than redefined. */
export { STALE_DATA_MAX_AGE_MS } from "@/server/intelligence/strategy/scoring";
