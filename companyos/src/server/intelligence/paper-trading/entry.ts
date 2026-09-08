import type { PaperPositionDirection } from "@prisma/client";
import { MAX_SIMULTANEOUS_POSITIONS, MAX_TOTAL_EXPOSURE_MULTIPLE, STALE_DATA_MAX_AGE_MS } from "@/server/intelligence/paper-trading/constants";
import { buildEntryPlan } from "@/server/intelligence/paper-trading/sizing";
import type { EntryDecision, PaperEntryPlan, StrategyCandidate } from "@/server/intelligence/paper-trading/types";
import type { PaperAccountView } from "@/server/intelligence/paper-trading/account";
import type { MarketMetricsSnapshotPayload } from "@/server/intelligence/strategy/types";

function directionFromCandidate(candidate: StrategyCandidate): PaperPositionDirection | null {
  if (candidate.direction === "up") return "LONG";
  if (candidate.direction === "down") return "SHORT";
  // RANGE_MEAN_REVERSION carries no directional bias by design (Sprint 15's
  // own thesis is "reversion toward the mean," not a directional call) --
  // the paper engine does not fabricate a direction the strategy layer
  // never claims. See Sprint 16 Phase 21's own "do not fake short signals."
  return null;
}

/**
 * The full deterministic pre-entry gate (Sprint 16 Phase 6/22): every
 * condition is checked, in order, and the first one that fails produces an
 * explicit, explainable skip reason -- entry is never silent, and never
 * decided by an LLM or randomness. `existingOpenNotional` is the sum of
 * every OTHER currently-open position's notional (this candidate's own
 * plan is added on top when checking the total-exposure ceiling).
 */
export function decideEntry(params: {
  candidate: StrategyCandidate;
  metrics: MarketMetricsSnapshotPayload;
  account: PaperAccountView;
  hasExistingPositionForSymbol: boolean;
  openPositionCount: number;
  existingOpenNotional: number;
  now?: number;
}): EntryDecision & { plan?: PaperEntryPlan } {
  const { candidate, metrics, account, hasExistingPositionForSymbol, openPositionCount, existingOpenNotional } = params;
  const now = params.now ?? Date.now();

  if (candidate.strategyType === "NO_TRADE") return { opened: false, reason: "no_trade_strategy" };

  const direction = directionFromCandidate(candidate);
  if (!direction) return { opened: false, reason: "no_direction" };

  if (now - new Date(metrics.observedAt).getTime() > STALE_DATA_MAX_AGE_MS) return { opened: false, reason: "stale_data" };

  if (hasExistingPositionForSymbol) return { opened: false, reason: "already_open" };

  if (openPositionCount >= MAX_SIMULTANEOUS_POSITIONS) return { opened: false, reason: "max_positions_reached" };

  const plan = buildEntryPlan({
    direction,
    entryPrice: metrics.lastClose,
    volatilityPct: metrics.volatilityPct,
    confidence: candidate.confidence,
    equity: account.currentEquity,
  });

  if (plan.initialMargin > account.availableMargin) return { opened: false, reason: "insufficient_margin" };

  const totalExposureAfterEntry = existingOpenNotional + plan.notional;
  if (totalExposureAfterEntry > account.currentEquity * MAX_TOTAL_EXPOSURE_MULTIPLE) {
    return { opened: false, reason: "max_exposure_reached" };
  }

  return { opened: true, plan };
}
