import { MIN_SAMPLE_SIZE, shrinkSuccessRate } from "@/server/intelligence/decision-intelligence/sample-safety";
import { CONFIDENCE_BUCKETS } from "@/server/intelligence/learning/service";
import { loadTradesAndOutcomes, type TradeRow } from "@/server/intelligence/strategy-performance/service";
import type {
  ConfidenceCalibrationEntry,
  DirectionRobustness,
  DrawdownResult,
  EvidenceQuality,
  FailureAnalysis,
  FailureReasonCategory,
  LeverageRobustness,
  RegimeRobustnessEntry,
  RiskAdjustedReturn,
  StrategyEvaluation,
  StrategyEvaluationScoreBreakdown,
  SymbolRobustness,
  TemporalRobustness,
} from "@/server/intelligence/strategy-evaluation/types";

const round2 = (v: number): number => Math.round(v * 100) / 100;

type OutcomeType = "success" | "failure" | "neutral" | "expired" | "reversed" | "unknown";

function isWin(outcomeByTradeId: Map<string, OutcomeType | null>, t: TradeRow): boolean {
  return outcomeByTradeId.get(t.id) === "success";
}

function isFailureOutcome(outcomeType: OutcomeType | null | undefined): boolean {
  return outcomeType === "failure" || outcomeType === "reversed";
}

/**
 * The 4-level refinement of the existing binary sample-size gate (Phase 3).
 * `insufficient` is deliberately pinned to the EXACT SAME boundary as
 * `decision-intelligence/sample-safety.ts#MIN_SAMPLE_SIZE` (5) -- checked
 * first, before picking these numbers, rather than blindly copying the
 * spec's own illustrative thresholds in isolation. `20`/`50` are then
 * adopted as the `limited`/`moderate`/`strong` boundaries because they
 * happen to match the spec's own worked example AND because they are a
 * clean 4x/10x multiple of the existing `MIN_SAMPLE_SIZE` -- not an
 * arbitrary re-guess. A strategy with 2 evaluated trades can never be
 * anything but `insufficient`, regardless of its win rate.
 */
const LIMITED_MAX = 19;
const MODERATE_MAX = 49;

export function evidenceQualityFor(evaluatedTrades: number): EvidenceQuality {
  if (evaluatedTrades < MIN_SAMPLE_SIZE) return "insufficient";
  if (evaluatedTrades <= LIMITED_MAX) return "limited";
  if (evaluatedTrades <= MODERATE_MAX) return "moderate";
  return "strong";
}

/**
 * Deterministic, zero-variance-safe, insufficient-data-safe Sharpe-like
 * ratio (Phase 4): mean return-on-margin divided by its sample standard
 * deviation. `MAX_RISK_ADJUSTED_MAGNITUDE` (3) is a documented sanity cap
 * -- common Sharpe-ratio conventions treat values beyond roughly this
 * range as practically meaningless outliers, and it is what keeps a
 * zero-variance sample (every trade closed at the exact same return) from
 * ever producing `Infinity`/`NaN`: such a sample is capped at the bound
 * (sign-preserved), never silently divided by zero.
 */
const MAX_RISK_ADJUSTED_MAGNITUDE = 3;

export function computeRiskAdjustedReturn(returns: number[]): RiskAdjustedReturn {
  if (returns.length < MIN_SAMPLE_SIZE) return { status: "insufficient_evidence" };
  const mean = returns.reduce((sum, v) => sum + v, 0) / returns.length;
  const variance = returns.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (returns.length - 1);
  const stdev = Math.sqrt(variance);

  if (stdev === 0) {
    const value = mean === 0 ? 0 : Math.sign(mean) * MAX_RISK_ADJUSTED_MAGNITUDE;
    return { status: "computed", value: round2(value), cappedAtBound: mean !== 0 };
  }

  const raw = mean / stdev;
  const clamped = Math.max(-MAX_RISK_ADJUSTED_MAGNITUDE, Math.min(MAX_RISK_ADJUSTED_MAGNITUDE, raw));
  return { status: "computed", value: round2(clamped), cappedAtBound: clamped !== raw };
}

/**
 * Peak-to-trough drawdown (Phase 5) of the reconstructed cumulative-P&L
 * sequence for one slice of CLOSED trades, ordered by `closedAt` (ties
 * broken by `id` so replay is always identical -- Phase 5's own "aynı
 * timestamp" edge case). The running peak starts at exactly 0 (before any
 * trade in the slice, nothing has happened yet), so a slice that is
 * losses-only still shows a real, honest drawdown from that implicit
 * zero baseline -- it is never reported as "no drawdown" just because
 * equity never had a chance to rise first. `maxDrawdownPct` is `0` (not
 * `null`) when the deepest point ever reached is the final peak itself
 * (an all-wins, or all-flat, sequence) and that peak is positive; it stays
 * `null` only when the sequence never produced a positive peak at all
 * (an all-losses, or all-exactly-zero, sequence) -- there is no positive
 * baseline to express a percentage against.
 */
export function computeMaxDrawdown(trades: Array<{ id: string; closedAt: Date; netPnl: number }>): DrawdownResult {
  if (trades.length === 0) return { status: "no_data" };

  const ordered = [...trades].sort((a, b) => a.closedAt.getTime() - b.closedAt.getTime() || a.id.localeCompare(b.id));

  let cumulative = 0;
  let peak = 0;
  let maxDrawdownPnl = 0;
  let troughValue = 0;
  let peakBeforeTrough = 0;

  for (const t of ordered) {
    cumulative += t.netPnl;
    if (cumulative > peak) peak = cumulative;
    const drawdown = peak - cumulative;
    if (drawdown > maxDrawdownPnl) {
      maxDrawdownPnl = drawdown;
      troughValue = cumulative;
      peakBeforeTrough = peak;
    }
  }

  if (maxDrawdownPnl === 0) peakBeforeTrough = peak;

  const maxDrawdownPct = peakBeforeTrough > 0 ? round2((maxDrawdownPnl / peakBeforeTrough) * 100) : null;

  return {
    status: "computed",
    maxDrawdownPnl: round2(maxDrawdownPnl),
    maxDrawdownPct,
    peakPnl: round2(peakBeforeTrough),
    troughPnl: round2(troughValue),
  };
}

/**
 * Herfindahl-style concentration of REALIZED P&L across symbols (Phase 7),
 * over each symbol's ABSOLUTE net P&L share (not signed) so that two
 * symbols with offsetting gains/losses don't cancel out into a falsely
 * "diversified" reading. Bounded `(1/N, 1]`; `null` when there is nothing
 * to allocate a share of (no symbols, or every symbol netted to exactly
 * zero).
 */
function computeConcentrationIndex(pnlBySymbol: number[]): number | null {
  const absValues = pnlBySymbol.map(Math.abs);
  const total = absValues.reduce((sum, v) => sum + v, 0);
  if (total === 0 || absValues.length === 0) return null;
  const sumSquares = absValues.reduce((sum, v) => sum + (v / total) ** 2, 0);
  return round2(sumSquares);
}

function symbolRobustnessFor(trades: TradeRow[]): SymbolRobustness {
  const bySymbol = new Map<string, number>();
  for (const t of trades) bySymbol.set(t.symbol, (bySymbol.get(t.symbol) ?? 0) + t.netPnl);
  const entries = [...bySymbol.entries()];

  let bestSymbol: { symbol: string; netPnl: number } | null = null;
  let worstSymbol: { symbol: string; netPnl: number } | null = null;
  let profitableSymbols = 0;
  let losingSymbols = 0;
  for (const [symbol, netPnl] of entries) {
    if (netPnl > 0) profitableSymbols += 1;
    else if (netPnl < 0) losingSymbols += 1;
    if (!bestSymbol || netPnl > bestSymbol.netPnl) bestSymbol = { symbol, netPnl: round2(netPnl) };
    if (!worstSymbol || netPnl < worstSymbol.netPnl) worstSymbol = { symbol, netPnl: round2(netPnl) };
  }

  return {
    uniqueSymbols: entries.length,
    profitableSymbols,
    losingSymbols,
    breakEvenSymbols: entries.length - profitableSymbols - losingSymbols,
    bestSymbol,
    worstSymbol,
    concentrationIndex: computeConcentrationIndex(entries.map(([, pnl]) => pnl)),
  };
}

/**
 * Regime label placed symmetrically around `shrinkSuccessRate`'s own
 * neutral 50% prior, with a documented +/-5 dead zone -- not an arbitrary
 * cutoff. A regime with fewer than `MIN_SAMPLE_SIZE` evaluated trades is
 * always `insufficient`, regardless of its raw win rate.
 */
function robustnessLabelFor(evidenceQuality: EvidenceQuality, shrunkWinRate: number): RegimeRobustnessEntry["label"] {
  if (evidenceQuality === "insufficient") return "insufficient";
  if (shrunkWinRate >= 55) return "strong";
  if (shrunkWinRate >= 45) return "moderate";
  return "weak";
}

function regimeRobustnessFor(trades: TradeRow[], outcomeByTradeId: Map<string, OutcomeType | null>): RegimeRobustnessEntry[] {
  const regimes = [...new Set(trades.map((t) => t.regime ?? "unknown"))].sort();
  return regimes.map((regime) => {
    const subset = trades.filter((t) => (t.regime ?? "unknown") === regime);
    const evaluated = subset.filter((t) => outcomeByTradeId.get(t.id));
    const wins = evaluated.filter((t) => isWin(outcomeByTradeId, t)).length;
    const evidenceQuality = evidenceQualityFor(evaluated.length);
    const shrunkWinRate = shrinkSuccessRate(wins, evaluated.length);
    return { regime, evaluatedTrades: evaluated.length, evidenceQuality, shrunkWinRate, label: robustnessLabelFor(evidenceQuality, shrunkWinRate) };
  });
}

function directionRobustnessFor(trades: TradeRow[], outcomeByTradeId: Map<string, OutcomeType | null>): DirectionRobustness[] {
  return (["LONG", "SHORT"] as const)
    .map((direction) => {
      const subset = trades.filter((t) => t.direction === direction);
      const evaluated = subset.filter((t) => outcomeByTradeId.get(t.id));
      const wins = evaluated.filter((t) => isWin(outcomeByTradeId, t)).length;
      return {
        direction,
        sampleSize: subset.length,
        evidenceQuality: evidenceQualityFor(evaluated.length),
        winRate: evaluated.length > 0 ? round2((wins / evaluated.length) * 100) : null,
        averageReturnPct: subset.length > 0 ? round2((subset.reduce((s, t) => s + t.returnPct, 0) / subset.length) * 100) : null,
        drawdown: computeMaxDrawdown(subset),
      };
    })
    .filter((d) => d.sampleSize > 0);
}

function leverageRobustnessFor(trades: TradeRow[], outcomeByTradeId: Map<string, OutcomeType | null>): LeverageRobustness[] {
  const leverages = [...new Set(trades.map((t) => t.leverage))].sort((a, b) => a - b);
  return leverages.map((leverage) => {
    const subset = trades.filter((t) => t.leverage === leverage);
    const evaluated = subset.filter((t) => outcomeByTradeId.get(t.id));
    const liquidations = subset.filter((t) => t.closeReason === "LIQUIDATED").length;
    return {
      leverage,
      sampleSize: subset.length,
      evidenceQuality: evidenceQualityFor(evaluated.length),
      averageReturnPct: subset.length > 0 ? round2((subset.reduce((s, t) => s + t.returnPct, 0) / subset.length) * 100) : null,
      liquidationRate: subset.length > 0 ? round2((liquidations / subset.length) * 100) : null,
      drawdown: computeMaxDrawdown(subset),
      riskAdjustedReturn: computeRiskAdjustedReturn(subset.map((t) => t.returnPct)),
    };
  });
}

/**
 * Splits already-CLOSED trades into three chronologically-ordered,
 * non-overlapping slices (Phase 10) via plain integer division -- never a
 * calendar window (a fixed "3 months" cutoff would be empty for a
 * low-volume organization, or would silently mix in wall-clock time as an
 * undocumented variable). Any remainder from the division falls into
 * `recent` (documented below), so `recent` is the only bucket that may be
 * LARGER than the other two -- never smaller, which would otherwise
 * shrink exactly the bucket most relevant to "is it still working now."
 * `insufficient_evidence` overall when there are fewer than 3 closed
 * trades to split at all; each bucket ALSO carries its own
 * `evidenceQuality`, since a technically-computable bucket can still be
 * too small on its own to trust. No candle data, no simulated trade is
 * ever introduced here -- only real, already-closed `PaperTrade` rows in
 * their real close order, so there is no look-ahead bias to guard against
 * beyond ordinary chronological sorting.
 */
function temporalRobustnessFor(trades: TradeRow[], outcomeByTradeId: Map<string, OutcomeType | null>): TemporalRobustness {
  if (trades.length < 3) return { status: "insufficient_evidence" };

  const ordered = [...trades].sort((a, b) => a.closedAt.getTime() - b.closedAt.getTime() || a.id.localeCompare(b.id));
  const size = Math.max(1, Math.floor(ordered.length / 3));
  const slices: Array<{ bucket: "older" | "previous" | "recent"; slice: TradeRow[] }> = [
    { bucket: "older", slice: ordered.slice(0, size) },
    { bucket: "previous", slice: ordered.slice(size, size * 2) },
    { bucket: "recent", slice: ordered.slice(size * 2) },
  ];

  return {
    status: "computed",
    buckets: slices.map(({ bucket, slice }) => {
      const evaluated = slice.filter((t) => outcomeByTradeId.get(t.id));
      const wins = evaluated.filter((t) => isWin(outcomeByTradeId, t)).length;
      return {
        bucket,
        sampleSize: slice.length,
        evidenceQuality: evidenceQualityFor(evaluated.length),
        winRate: evaluated.length > 0 ? round2((wins / evaluated.length) * 100) : null,
        averageReturnPct: slice.length > 0 ? round2((slice.reduce((s, t) => s + t.returnPct, 0) / slice.length) * 100) : null,
      };
    }),
  };
}

function confidenceCalibrationFor(trades: TradeRow[], outcomeByTradeId: Map<string, OutcomeType | null>): ConfidenceCalibrationEntry[] {
  return CONFIDENCE_BUCKETS.map((bucket) => {
    const inBucket = trades.filter((t) => t.candidateConfidence !== null && t.candidateConfidence >= bucket.min && t.candidateConfidence <= bucket.max);
    const evaluated = inBucket.filter((t) => outcomeByTradeId.get(t.id));
    const successCount = evaluated.filter((t) => isWin(outcomeByTradeId, t)).length;
    return { ...bucket, totalEvaluated: evaluated.length, successCount, observedSuccessRate: evaluated.length > 0 ? round2((successCount / evaluated.length) * 100) : null };
  });
}

/**
 * Reuses the existing `0-59`/`60-79`/`80-89`/`90-100` confidence-bucket
 * floor already established by `learning/service.ts#CONFIDENCE_BUCKETS`
 * -- `60` is that scheme's own lowest non-bottom-bucket boundary, not a
 * newly-invented number.
 */
const LOW_CONFIDENCE_THRESHOLD = 60;

/**
 * Failure classification (Phase 13) restricted to categories
 * DETERMINISTICALLY derivable from fields already persisted on a closed
 * `PaperTrade` -- `closeReason` (liquidation/stop/invalidation),
 * `regime` compared against this SAME strategy's own best-performing
 * regime (computed from real data, never hardcoded), and the
 * entry-snapshotted `candidateConfidence`. The spec's own illustrative
 * list also names categories like "excessive volatility," "weak trend,"
 * "wrong direction," and "stale data" -- none of those are recoverable
 * from what a closed `PaperTrade` actually stores today (volatility/trend
 * strength were never snapshotted, and re-reading the original
 * `CompanySignal` at evaluation time would reintroduce the exact
 * live-mutation trap Sprint 17 already fixed by snapshotting
 * `candidateScore`/`candidateConfidence` in the first place). Rather than
 * fabricate a reason with no real evidence behind it (Phase 13's own
 * explicit prohibition), an unmatched failing trade is honestly labeled
 * `unclassified`.
 */
function failureAnalysisFor(trades: TradeRow[], outcomeByTradeId: Map<string, OutcomeType | null>, regimeRobustness: RegimeRobustnessEntry[]): FailureAnalysis {
  const failing = trades.filter((t) => isFailureOutcome(outcomeByTradeId.get(t.id)));

  const bestRegime = [...regimeRobustness].filter((r) => r.evidenceQuality !== "insufficient").sort((a, b) => b.shrunkWinRate - a.shrunkWinRate)[0] ?? null;

  const counts = new Map<FailureReasonCategory, number>();
  const bump = (reason: FailureReasonCategory): void => {
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  };

  for (const t of failing) {
    if (t.closeReason === "LIQUIDATED") {
      bump("liquidation");
    } else if (t.closeReason === "STOPPED") {
      bump("stop_loss");
    } else if (t.closeReason === "INVALIDATED") {
      bump("invalidated");
    } else if (bestRegime && (t.regime ?? "unknown") !== bestRegime.regime) {
      bump("regime_mismatch");
    } else if (t.candidateConfidence !== null && t.candidateConfidence < LOW_CONFIDENCE_THRESHOLD) {
      bump("low_confidence_entry");
    } else {
      bump("unclassified");
    }
  }

  return {
    totalFailingTrades: failing.length,
    byReason: [...counts.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
  };
}

/**
 * Bounded [0,100], deterministic, additive Strategy Evaluation Score
 * (Phase 11) -- every coefficient below is a named constant, never a
 * hidden magic number, and never LLM-assigned. Positive components sum to
 * exactly 100 at their individual maximums (40+20+15+10+15); penalties
 * subtract from that total and the final result is clamped to [0,100].
 * "Concentration penalty" from the spec is expressed as a POSITIVE reward
 * for diversification (`symbolRobustnessComponent`) rather than a
 * separate penalty term, to avoid double-counting the same underlying
 * signal twice in one additive formula.
 */
const PERFORMANCE_MAX = 40;
const CONSISTENCY_MAX = 20;
const REGIME_ROBUSTNESS_MAX = 15;
const SYMBOL_ROBUSTNESS_MAX = 10;
const CONFIDENCE_CALIBRATION_MAX = 15;
const DRAWDOWN_PENALTY_MAX = 20;
const LIQUIDATION_PENALTY_MAX = 15;

function computeEvaluationScore(input: {
  shrunkWinRate: number;
  riskAdjustedReturn: RiskAdjustedReturn;
  regimeRobustness: RegimeRobustnessEntry[];
  symbolRobustness: SymbolRobustness;
  confidenceCalibration: ConfidenceCalibrationEntry[];
  maxDrawdown: DrawdownResult;
  liquidationCount: number;
  sampleSize: number;
}): { score: number; breakdown: StrategyEvaluationScoreBreakdown } {
  const performanceComponent = (input.shrunkWinRate / 100) * PERFORMANCE_MAX;

  const consistencyComponent =
    input.riskAdjustedReturn.status === "computed"
      ? Math.max(0, Math.min(CONSISTENCY_MAX, (input.riskAdjustedReturn.value / MAX_RISK_ADJUSTED_MAGNITUDE) * CONSISTENCY_MAX))
      : 0;

  const sufficientRegimes = input.regimeRobustness.filter((r) => r.evidenceQuality !== "insufficient");
  const regimeRobustnessComponent = sufficientRegimes.length > 0 ? (Math.min(...sufficientRegimes.map((r) => r.shrunkWinRate)) / 100) * REGIME_ROBUSTNESS_MAX : 0;

  const symbolRobustnessComponent = input.symbolRobustness.concentrationIndex !== null ? (1 - input.symbolRobustness.concentrationIndex) * SYMBOL_ROBUSTNESS_MAX : 0;

  const sufficientBuckets = input.confidenceCalibration.filter((b) => b.totalEvaluated >= MIN_SAMPLE_SIZE);
  const confidenceCalibrationComponent =
    sufficientBuckets.length > 0
      ? Math.max(
          0,
          1 -
            sufficientBuckets.reduce((sum, b) => {
              const midpoint = (b.min + b.max) / 2;
              return sum + Math.abs((b.observedSuccessRate ?? midpoint) - midpoint) / 100;
            }, 0) /
              sufficientBuckets.length,
        ) * CONFIDENCE_CALIBRATION_MAX
      : 0;

  const drawdownPenalty = input.maxDrawdown.status === "computed" && input.maxDrawdown.maxDrawdownPct !== null ? Math.min(1, input.maxDrawdown.maxDrawdownPct / 100) * DRAWDOWN_PENALTY_MAX : 0;

  const liquidationRatio = input.sampleSize > 0 ? input.liquidationCount / input.sampleSize : 0;
  const liquidationPenalty = liquidationRatio * LIQUIDATION_PENALTY_MAX;

  const raw = performanceComponent + consistencyComponent + regimeRobustnessComponent + symbolRobustnessComponent + confidenceCalibrationComponent - drawdownPenalty - liquidationPenalty;
  const score = Math.max(0, Math.min(100, round2(raw)));

  return {
    score,
    breakdown: {
      performanceComponent: round2(performanceComponent),
      consistencyComponent: round2(consistencyComponent),
      regimeRobustnessComponent: round2(regimeRobustnessComponent),
      symbolRobustnessComponent: round2(symbolRobustnessComponent),
      confidenceCalibrationComponent: round2(confidenceCalibrationComponent),
      drawdownPenalty: round2(drawdownPenalty),
      liquidationPenalty: round2(liquidationPenalty),
    },
  };
}

function evaluateStrategyType(strategyType: string, subset: TradeRow[], outcomeByTradeId: Map<string, OutcomeType | null>): StrategyEvaluation {
  const evaluated = subset.filter((t) => outcomeByTradeId.get(t.id));
  const evaluatedTrades = evaluated.length;

  if (evaluatedTrades < MIN_SAMPLE_SIZE) {
    return { status: "insufficient_evidence", strategyType, evaluatedTrades, minimumRequired: MIN_SAMPLE_SIZE };
  }

  const wins = evaluated.filter((t) => isWin(outcomeByTradeId, t)).length;
  const winRate = round2((wins / evaluatedTrades) * 100);
  const shrunkWinRate = shrinkSuccessRate(wins, evaluatedTrades);

  const liquidations = subset.filter((t) => t.closeReason === "LIQUIDATED").length;
  const stops = subset.filter((t) => t.closeReason === "STOPPED").length;
  const takeProfits = subset.filter((t) => t.closeReason === "TAKE_PROFIT").length;
  const invalidations = subset.filter((t) => t.closeReason === "INVALIDATED").length;

  const totalRealizedPnl = round2(subset.reduce((sum, t) => sum + t.netPnl, 0));
  const netPnls = subset.map((t) => t.netPnl);

  const maxDrawdown = computeMaxDrawdown(subset);
  const regimeRobustness = regimeRobustnessFor(subset, outcomeByTradeId);
  const symbolRobustness = symbolRobustnessFor(subset);
  const confidenceCalibration = confidenceCalibrationFor(subset, outcomeByTradeId);
  const riskAdjustedReturn = computeRiskAdjustedReturn(subset.map((t) => t.returnPct));

  const { score, breakdown } = computeEvaluationScore({
    shrunkWinRate,
    riskAdjustedReturn,
    regimeRobustness,
    symbolRobustness,
    confidenceCalibration,
    maxDrawdown,
    liquidationCount: liquidations,
    sampleSize: subset.length,
  });

  return {
    status: "evaluated",
    strategyType,
    evidenceQuality: evidenceQualityFor(evaluatedTrades),
    sampleSize: subset.length,
    evaluatedTrades,
    winRate,
    averageReturnPct: round2((subset.reduce((sum, t) => sum + t.returnPct, 0) / subset.length) * 100),
    totalRealizedPnl,
    averagePnl: round2(totalRealizedPnl / subset.length),
    bestTradePnl: round2(Math.max(...netPnls)),
    worstTradePnl: round2(Math.min(...netPnls)),
    maxDrawdown,
    liquidationRate: round2((liquidations / subset.length) * 100),
    stopRate: round2((stops / subset.length) * 100),
    takeProfitRate: round2((takeProfits / subset.length) * 100),
    invalidationRate: round2((invalidations / subset.length) * 100),
    averageHoldingDurationMs: Math.round(subset.reduce((sum, t) => sum + (t.closedAt.getTime() - t.openedAt.getTime()), 0) / subset.length),
    feeImpact: round2(subset.reduce((sum, t) => sum + t.feesPaid, 0)),
    fundingImpact: round2(subset.reduce((sum, t) => sum + t.fundingPaid, 0)),
    riskAdjustedReturn,
    confidenceCalibration,
    regimeRobustness,
    symbolRobustness,
    directionRobustness: directionRobustnessFor(subset, outcomeByTradeId),
    leverageRobustness: leverageRobustnessFor(subset, outcomeByTradeId),
    temporalRobustness: temporalRobustnessFor(subset, outcomeByTradeId),
    failureAnalysis: failureAnalysisFor(subset, outcomeByTradeId, regimeRobustness),
    evaluationScore: score,
    scoreBreakdown: breakdown,
  };
}

/** Every deterministic Strategy Evaluation for an organization, one per strategy type that has ever produced a closed `PaperTrade` -- `NO_TRADE` never appears (same structural absence `strategy-performance/service.ts` already documents). */
export async function getStrategyEvaluations(organizationId: string): Promise<StrategyEvaluation[]> {
  const { trades, outcomeByTradeId } = await loadTradesAndOutcomes(organizationId);
  const strategyTypes = [...new Set(trades.map((t) => t.strategyType))].sort();
  return strategyTypes.map((strategyType) => evaluateStrategyType(strategyType, trades.filter((t) => t.strategyType === strategyType), outcomeByTradeId));
}

/** The deterministic Strategy Evaluation for one specific strategy type -- `evaluatedTrades: 0` (and `status: "insufficient_evidence"`) for a strategy type this organization has never actually traded, never an error. */
export async function getStrategyEvaluation(organizationId: string, strategyType: string): Promise<StrategyEvaluation> {
  const { trades, outcomeByTradeId } = await loadTradesAndOutcomes(organizationId);
  return evaluateStrategyType(strategyType, trades.filter((t) => t.strategyType === strategyType), outcomeByTradeId);
}
