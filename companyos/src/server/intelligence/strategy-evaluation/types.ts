/**
 * Sprint 18: "how much can we trust this performance, and under what
 * conditions does it actually work?" -- built entirely on top of Sprint
 * 17's `strategy-performance` aggregation (which itself sits on the real,
 * already-persisted `PaperTrade`/`Outcome` rows). No new Prisma model, no
 * new migration: every type here is a computed, in-memory shape, never
 * persisted, so there is nothing to duplicate on a re-run (Phase 18).
 */

/**
 * A 4-level refinement of the existing binary `SampleSizeStatus`
 * ("insufficient_sample" / "sufficient_sample") -- not a replacement.
 * `insufficient` is defined at EXACTLY the same boundary as the existing
 * `sample-safety.ts#MIN_SAMPLE_SIZE` (5), so the two vocabularies never
 * disagree about "do we have enough evidence at all." `limited`/
 * `moderate`/`strong` further subdivide what the old model only ever
 * called "sufficient" -- see `EVIDENCE_QUALITY_THRESHOLDS` for the exact,
 * documented cutoffs.
 */
export type EvidenceQuality = "insufficient" | "limited" | "moderate" | "strong";

/**
 * A deterministic, zero-variance-safe, bounded Sharpe-like ratio
 * (mean return / stdev of return) over evaluated trades. Never a raw
 * division: `status: "insufficient_evidence"` below `MIN_SAMPLE_SIZE`
 * evaluated trades, and a documented magnitude cap (never `Infinity`/
 * `NaN`) when every return in the sample is identical (zero variance).
 */
export type RiskAdjustedReturn =
  | { status: "insufficient_evidence" }
  | { status: "computed"; value: number; cappedAtBound: boolean };

/**
 * Peak-to-trough drawdown of the RECONSTRUCTED cumulative-P&L sequence for
 * one slice of closed trades (a strategy type, a direction, a leverage
 * tier -- never the whole account/portfolio, which is a different,
 * already-existing figure on `PaperAccount`). `maxDrawdownPct` is `null`
 * when the deepest drawdown's own preceding peak was never positive (an
 * all-losses sequence, or a sequence that never had a real gain before its
 * worst point) -- dividing by a non-positive baseline would be meaningless,
 * not a bug to paper over with a fabricated percentage.
 */
export type DrawdownResult =
  | { status: "no_data" }
  | { status: "computed"; maxDrawdownPnl: number; maxDrawdownPct: number | null; peakPnl: number; troughPnl: number };

export type RegimeRobustnessEntry = {
  regime: string;
  evaluatedTrades: number;
  evidenceQuality: EvidenceQuality;
  shrunkWinRate: number;
  /** `insufficient` mirrors `evidenceQuality`; otherwise placed around the neutral 50% Laplace prior (see `robustnessLabelFor`'s own doc comment for the exact, documented boundary). */
  label: "strong" | "moderate" | "weak" | "insufficient";
};

export type SymbolRobustness = {
  uniqueSymbols: number;
  profitableSymbols: number;
  losingSymbols: number;
  breakEvenSymbols: number;
  bestSymbol: { symbol: string; netPnl: number } | null;
  worstSymbol: { symbol: string; netPnl: number } | null;
  /**
   * Herfindahl-style concentration of REALIZED P&L across symbols, bounded
   * (1/N, 1] for N>=1 symbols: `1` means one symbol accounts for all of
   * this strategy's P&L magnitude; `1/N` means it is spread perfectly
   * evenly across all N. `null` only when there is no symbol data at all,
   * or every symbol netted to exactly zero (nothing to allocate a share
   * of) -- never a fabricated 0.
   */
  concentrationIndex: number | null;
};

export type DirectionRobustness = {
  direction: "LONG" | "SHORT";
  sampleSize: number;
  evidenceQuality: EvidenceQuality;
  winRate: number | null;
  averageReturnPct: number | null;
  drawdown: DrawdownResult;
};

export type LeverageRobustness = {
  leverage: number;
  sampleSize: number;
  evidenceQuality: EvidenceQuality;
  averageReturnPct: number | null;
  liquidationRate: number | null;
  drawdown: DrawdownResult;
  riskAdjustedReturn: RiskAdjustedReturn;
};

export type TemporalBucketLabel = "older" | "previous" | "recent";

export type TemporalRobustnessEntry = {
  bucket: TemporalBucketLabel;
  sampleSize: number;
  evidenceQuality: EvidenceQuality;
  winRate: number | null;
  averageReturnPct: number | null;
};

/**
 * Splits already-closed trades into three chronologically-ordered,
 * non-overlapping slices (Phase 10) -- never candle data, never a
 * simulated/backtested trade, so there is no look-ahead bias to guard
 * against beyond ordinary chronological ordering. `insufficient_evidence`
 * when there are fewer than 3 closed trades to split at all.
 */
export type TemporalRobustness = { status: "insufficient_evidence" } | { status: "computed"; buckets: TemporalRobustnessEntry[] };

/**
 * Only categories deterministically derivable from fields ALREADY
 * persisted on `PaperTrade` -- see `failureAnalysisFor`'s own doc comment
 * for exactly why illustrative categories from the spec like "excessive
 * volatility"/"weak trend"/"wrong direction" are deliberately NOT included
 * here (Phase 13's own explicit "bu nedenleri gerçek evidence olmadan
 * uydurma").
 */
export type FailureReasonCategory = "liquidation" | "stop_loss" | "invalidated" | "regime_mismatch" | "low_confidence_entry" | "unclassified";

export type FailureAnalysis = {
  totalFailingTrades: number;
  byReason: { reason: FailureReasonCategory; count: number }[];
};

export type ConfidenceCalibrationEntry = {
  label: string;
  min: number;
  max: number;
  totalEvaluated: number;
  successCount: number;
  observedSuccessRate: number | null;
};

export type StrategyEvaluationScoreBreakdown = {
  performanceComponent: number;
  consistencyComponent: number;
  regimeRobustnessComponent: number;
  symbolRobustnessComponent: number;
  confidenceCalibrationComponent: number;
  drawdownPenalty: number;
  liquidationPenalty: number;
};

/**
 * The full Sprint 18 deterministic evaluation of one strategy type.
 * `status: "insufficient_evidence"` below `MIN_SAMPLE_SIZE` evaluated
 * trades -- no score, no "STRONG" label, no fabricated verdict is ever
 * produced from a handful of trades (the success criterion's own explicit
 * "bir stratejinin 2 başarılı işlemden sonra 'STRONG' görünmesine izin
 * verme").
 */
export type StrategyEvaluation =
  | { status: "insufficient_evidence"; strategyType: string; evaluatedTrades: number; minimumRequired: number }
  | {
      status: "evaluated";
      strategyType: string;
      evidenceQuality: EvidenceQuality;
      sampleSize: number;
      evaluatedTrades: number;
      winRate: number;
      averageReturnPct: number;
      totalRealizedPnl: number;
      averagePnl: number;
      bestTradePnl: number;
      worstTradePnl: number;
      maxDrawdown: DrawdownResult;
      liquidationRate: number;
      stopRate: number;
      takeProfitRate: number;
      invalidationRate: number;
      averageHoldingDurationMs: number;
      feeImpact: number;
      fundingImpact: number;
      riskAdjustedReturn: RiskAdjustedReturn;
      confidenceCalibration: ConfidenceCalibrationEntry[];
      regimeRobustness: RegimeRobustnessEntry[];
      symbolRobustness: SymbolRobustness;
      directionRobustness: DirectionRobustness[];
      leverageRobustness: LeverageRobustness[];
      temporalRobustness: TemporalRobustness;
      failureAnalysis: FailureAnalysis;
      /** Bounded [0,100], deterministic, additive -- see `computeEvaluationScore`'s own doc comment for every coefficient. Never LLM-assigned. */
      evaluationScore: number;
      scoreBreakdown: StrategyEvaluationScoreBreakdown;
    };

/** The minimal slice of a `StrategyEvaluation` the market-ranking layer (Phase 12) actually needs -- deliberately narrow so `market-intelligence/ranking.ts` never has to import or reason about the full evaluation shape. */
export type StrategyEvaluationSummary = {
  evidenceQuality: EvidenceQuality;
  evaluationScore: number;
};
