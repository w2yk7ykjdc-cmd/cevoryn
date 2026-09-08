import type { MarketMetricsSnapshotPayload } from "@/server/intelligence/signals/market-scanner";

export type { MarketMetricsSnapshotPayload };

/**
 * Sprint 15's deterministic strategy vocabulary. Deliberately small — this
 * is NOT a general-purpose trading-strategy taxonomy, just the minimum set
 * the spec calls for. `NO_TRADE` is a first-class member, not an absence of
 * a record: the engine must be able to say "no valid deterministic pattern
 * right now" and explain why, exactly as confidently as it says
 * `TREND_FOLLOWING`.
 */
export type StrategyType = "TREND_FOLLOWING" | "MOMENTUM_CONTINUATION" | "RANGE_MEAN_REVERSION" | "NO_TRADE";

/** Why a symbol was routed to `NO_TRADE` this run — always present when `strategyType === "NO_TRADE"`, always absent otherwise. */
export type NoTradeReason = "stale_data" | "unacceptable_risk" | "conflicting_signals" | "insufficient_evidence";

export type StrategyDirection = "up" | "down";

/**
 * The full explainable record a strategy candidate carries (Sprint 15
 * Phase: STRATEGY OUTPUT). Persisted as the `payload` of a
 * `market_strategy_candidate.v1` `CompanySignal` row — see
 * `strategy/generate.ts`'s own doc comment for why `CompanySignal` (not a
 * new Prisma model) is the right home for this.
 *
 * No dollar figures anywhere in this type — `riskUnit` is a normalized,
 * dimensionless sizing placeholder (never a real position size; there is no
 * account data), and `expectedScenario` is a plain-language, explicitly
 * hypothetical description, never a computed ROI/profit number.
 */
export type StrategyCandidate = {
  symbol: string;
  strategyType: StrategyType;
  strategyVersion: string;
  direction: StrategyDirection | null;
  score: number;
  confidence: number;
  marketRegime: string | null;
  supportingSignals: string[];
  contradictingSignals: string[];
  thesis: string;
  entryConditions: string[];
  invalidationConditions: string[];
  riskConditions: string[];
  expectedScenario: string;
  noTradeReason: NoTradeReason | null;
  riskUnit: number;
  sourceOpportunityId: string | null;
  sourceRiskId: string | null;
  observedAt: string;
};

/** The already-persisted context a strategy decision is built from — never refetched from Binance, never recomputed. `risk.conditions` is Sprint 14's own already-computed risk-condition list (`evaluateMarketRiskConditions`'s output, read back from `Risk.evidence`) — reused, not recomputed, to detect a `conflicting_signals` NO_TRADE without re-deriving it. */
export type StrategyInput = {
  metrics: MarketMetricsSnapshotPayload;
  regime: string | null;
  opportunity: { id: string; score: number; confidence: number } | null;
  risk: { id: string; severity: "low" | "medium" | "high" | "critical"; conditions: string[] } | null;
};
