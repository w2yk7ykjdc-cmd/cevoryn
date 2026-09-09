import type { EvidenceQuality } from "@/server/intelligence/strategy-evaluation/types";

export type { EvidenceQuality };

/**
 * Sprint 19's own decision vocabulary -- deliberately distinct from
 * `PaperPositionDirection` (`LONG`/`SHORT`): `BUY`/`SELL` are a market
 * DECISION (what should happen), `LONG`/`SHORT` is a PAPER POSITION fact
 * (what a simulated position actually is). `HOLD` means a directional
 * strategy candidate exists but there is already an open position for this
 * symbol (or the decision is otherwise not a fresh entry call). `NO_TRADE`
 * mirrors the strategy engine's own `NO_TRADE` conclusion (including the
 * non-directional `RANGE_MEAN_REVERSION` case) -- never fabricated, always
 * traced back to the real `StrategyCandidate` that produced it.
 */
export type MarketDecisionAction = "BUY" | "SELL" | "HOLD" | "NO_TRADE";

export type OrderValidationStatus = "VALID" | "REJECTED";

/**
 * Every reason is deterministically derived from already-computed data --
 * never fabricated, never LLM-assigned. See `service.ts#validateProposedOrder`
 * for the exact, ordered checks and which existing module each one reuses.
 */
export type OrderRejectReason =
  | "stale_data"
  | "insufficient_evidence"
  | "unacceptable_risk"
  | "exposure_limit"
  | "drawdown_limit"
  | "liquidation_risk"
  | "insufficient_margin"
  | "conflicting_signal"
  | "no_trade"
  | "invalid_quantity"
  | "invalid_price"
  | "invalid_stop"
  | "expired_decision";

/**
 * The execution-readiness abstraction (Sprint 19 Phase 4): everything a
 * FUTURE real order would need, computed and validated NOW, but never sent
 * anywhere. `null` only when the underlying decision is `HOLD`/`NO_TRADE`
 * (there is nothing to propose) OR the kill switch is engaged (Phase 7:
 * "execution proposal üretme" -- don't even generate a proposal, not just
 * reject one). Every price/quantity/leverage field is computed by the
 * EXACT SAME deterministic sizing Sprint 16 already uses
 * (`paper-trading/sizing.ts#buildEntryPlan`) -- never a second, competing
 * sizing formula.
 */
export type ProposedOrder = {
  symbol: string;
  direction: "LONG" | "SHORT";
  mode: "SPOT" | "PERPETUAL_SIMULATION";
  entryPrice: number;
  quantity: number;
  notional: number;
  initialMargin: number;
  leverage: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  liquidationPrice: number | null;
  /** The dollar risk this order represents if the stop is hit -- `paper-trading/sizing.ts#computePositionSizing`'s own `riskCapital`, reused verbatim. */
  risk: number;
  /** Plain-language summary of why this order is proposed -- drawn from the strategy candidate's own thesis, never fabricated separately. */
  reason: string;
  confidence: number;
  decisionTimestamp: string;
  /** ISO timestamp after which this specific proposal must be treated as stale and recomputed -- see `constants.ts#DECISION_VALIDITY_MS`. */
  expiresAt: string;
  validationStatus: OrderValidationStatus;
  rejectReason: OrderRejectReason | null;
};

/**
 * One symbol's full Sprint 19 decision: what the deterministic engine
 * recommends right now, how much of the surrounding evidence/risk/
 * evaluation context fed into it, and (for BUY/SELL) the concrete,
 * validated-or-rejected order that would express it. NEVER produced by an
 * LLM -- every field is a deterministic function of already-persisted
 * Sprint 13-18 data.
 */
export type MarketDecision = {
  symbol: string;
  action: MarketDecisionAction;
  strategyType: string;
  strategyScore: number;
  strategyConfidence: number;
  /** `null` when this strategy type has never been evaluated at all (fewer than the minimum sample size for ANY evaluation -- see `strategy-evaluation/service.ts`). */
  evaluationScore: number | null;
  evidenceQuality: EvidenceQuality;
  regime: string | null;
  riskSeverity: "low" | "medium" | "high" | "critical" | "none";
  /** Plain-language trace of every signal/strategy/risk/evidence input that shaped this decision (Sprint 19 Phase 8: auditability) -- built, never fabricated after the fact. */
  reasons: string[];
  /** True when the kill switch (organization-scoped OR system-wide) was engaged at decision time -- `proposedOrder` is always `null` in this case, regardless of what `action` would otherwise justify. */
  killSwitchEngaged: boolean;
  /** Sprint 26: true when THIS strategy type was QUARANTINED or RETIRED (`learning/strategy-health.ts`) at decision time -- `proposedOrder` is always `null` in this case too, same as the kill switch, but scoped to this one strategy type rather than every strategy. */
  strategyQuarantined: boolean;
  proposedOrder: ProposedOrder | null;
};
