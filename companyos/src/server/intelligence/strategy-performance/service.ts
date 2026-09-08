import type { OutcomeType } from "@prisma/client";
import { getTenantScopedClient } from "@/server/db/tenant";
import { sampleSizeStatusFor, shrinkSuccessRate } from "@/server/intelligence/decision-intelligence/sample-safety";
import { RULE_NAME as PAPER_TRADE_RULE_NAME, RULE_VERSION as PAPER_TRADE_RULE_VERSION } from "@/server/intelligence/outcome/rules/paper-trade-result";
import { getConfidenceCalibration } from "@/server/intelligence/learning/service";
import type {
  ConfidenceCalibrationBucket,
  DirectionPerformance,
  LeverageTierPerformance,
  PaperTradeOutcomeRow,
  RegimePerformance,
  StrategyPerformanceMetrics,
  StrategyTypePerformance,
  SymbolPerformance,
} from "@/server/intelligence/strategy-performance/types";

/**
 * Exported (Sprint 18) so `strategy-evaluation/service.ts` can build on
 * exactly this same shape rather than re-declaring an overlapping one --
 * `candidateConfidence` was added for Sprint 18's per-strategy confidence
 * calibration, which needs to join it against `outcomeType` in memory
 * (the generic `Outcome` model has no `strategyType` column of its own to
 * filter on directly, so this join has to happen here, not in `learning/
 * service.ts`).
 */
export type TradeRow = {
  id: string;
  strategyType: string;
  regime: string | null;
  symbol: string;
  direction: "LONG" | "SHORT";
  leverage: number;
  netPnl: number;
  returnPct: number;
  feesPaid: number;
  fundingPaid: number;
  closeReason: string;
  candidateConfidence: number | null;
  openedAt: Date;
  closedAt: Date;
};

const round2 = (v: number): number => Math.round(v * 100) / 100;

function median(sortedAscending: number[]): number | null {
  if (sortedAscending.length === 0) return null;
  const mid = Math.floor(sortedAscending.length / 2);
  return sortedAscending.length % 2 === 0 ? (sortedAscending[mid - 1]! + sortedAscending[mid]!) / 2 : sortedAscending[mid]!;
}

/**
 * Deterministic aggregation over a set of closed `PaperTrade` rows (Sprint
 * 17 Phase 4/5) — pure database-derived arithmetic, no ML, no statistics
 * package, matching Sprint 11/12's own established discipline. Win/loss/
 * neutral counts come from each trade's OWN `paper_trade_result.v1`
 * `Outcome.outcomeType` (never re-derived from a second, competing
 * threshold here) — `success` -> win, `failure`/`reversed` -> loss,
 * anything else evaluated (`neutral`/`expired`) -> neutral; a trade with no
 * evaluated `Outcome` yet (the hourly evaluation pass hasn't reached it)
 * contributes to `totalTrades` and the raw P&L/fee/duration figures, but
 * not to `evaluatedTrades`/win-loss counts -- "no verdict yet" is never
 * silently counted as a loss.
 */
function computeMetrics(trades: TradeRow[], outcomeByTradeId: Map<string, OutcomeType | null>): StrategyPerformanceMetrics {
  const totalTrades = trades.length;
  let winningTrades = 0;
  let losingTrades = 0;
  let neutralTrades = 0;
  let evaluatedTrades = 0;
  let totalRealizedPnl = 0;
  let totalFees = 0;
  let totalFunding = 0;
  let totalHoldingMs = 0;
  let liquidationCount = 0;
  let stopLossCount = 0;
  let takeProfitCount = 0;
  let invalidationCount = 0;
  let bestTradePnl: number | null = null;
  let worstTradePnl: number | null = null;
  const returns: number[] = [];

  for (const t of trades) {
    totalRealizedPnl += t.netPnl;
    totalFees += t.feesPaid;
    totalFunding += t.fundingPaid;
    totalHoldingMs += t.closedAt.getTime() - t.openedAt.getTime();
    returns.push(t.returnPct);
    if (bestTradePnl === null || t.netPnl > bestTradePnl) bestTradePnl = t.netPnl;
    if (worstTradePnl === null || t.netPnl < worstTradePnl) worstTradePnl = t.netPnl;

    if (t.closeReason === "LIQUIDATED") liquidationCount += 1;
    else if (t.closeReason === "STOPPED") stopLossCount += 1;
    else if (t.closeReason === "TAKE_PROFIT") takeProfitCount += 1;
    else if (t.closeReason === "INVALIDATED") invalidationCount += 1;

    const outcomeType = outcomeByTradeId.get(t.id);
    if (outcomeType) {
      evaluatedTrades += 1;
      if (outcomeType === "success") winningTrades += 1;
      else if (outcomeType === "failure" || outcomeType === "reversed") losingTrades += 1;
      else neutralTrades += 1;
    }
  }

  const sortedReturns = [...returns].sort((a, b) => a - b);
  const medianReturn = median(sortedReturns);

  return {
    totalTrades,
    evaluatedTrades,
    winningTrades,
    losingTrades,
    neutralTrades,
    winRate: evaluatedTrades > 0 ? round2((winningTrades / evaluatedTrades) * 100) : null,
    lossRate: evaluatedTrades > 0 ? round2((losingTrades / evaluatedTrades) * 100) : null,
    averageReturnPct: totalTrades > 0 ? round2((returns.reduce((sum, v) => sum + v, 0) / totalTrades) * 100) : null,
    medianReturnPct: medianReturn !== null ? round2(medianReturn * 100) : null,
    totalRealizedPnl: round2(totalRealizedPnl),
    averagePnl: totalTrades > 0 ? round2(totalRealizedPnl / totalTrades) : null,
    bestTradePnl: bestTradePnl !== null ? round2(bestTradePnl) : null,
    worstTradePnl: worstTradePnl !== null ? round2(worstTradePnl) : null,
    averageHoldingDurationMs: totalTrades > 0 ? Math.round(totalHoldingMs / totalTrades) : null,
    liquidationCount,
    stopLossCount,
    takeProfitCount,
    invalidationCount,
    totalFees: round2(totalFees),
    totalFunding: round2(totalFunding),
    shrunkWinRate: shrinkSuccessRate(winningTrades, evaluatedTrades),
    sampleSizeStatus: sampleSizeStatusFor(evaluatedTrades),
  };
}

/**
 * Loads every closed `PaperTrade` for an organization plus the
 * `outcomeType` each one's `paper_trade_result.v1` `Outcome` evaluated to
 * (if evaluated yet) -- exactly two queries total regardless of how many
 * different groupings the caller then computes in memory (Phase 36:
 * "avoid N+1 database queries"). `NO_TRADE` never appears here at all:
 * Sprint 16's own entry gate never creates a `PaperPosition` (and
 * therefore never a `PaperTrade`) for a `NO_TRADE` candidate, so there is
 * nothing to filter out -- it is structurally absent, not excluded.
 */
export async function loadTradesAndOutcomes(organizationId: string): Promise<{ trades: TradeRow[]; outcomeByTradeId: Map<string, OutcomeType | null> }> {
  const scoped = getTenantScopedClient(organizationId);
  const [tradeRows, outcomeRows] = await Promise.all([
    scoped.paperTrade.findMany({
      select: {
        id: true,
        strategyType: true,
        regime: true,
        symbol: true,
        direction: true,
        leverage: true,
        netPnl: true,
        returnPct: true,
        feesPaid: true,
        fundingPaid: true,
        closeReason: true,
        candidateConfidence: true,
        openedAt: true,
        closedAt: true,
      },
    }),
    scoped.outcome.findMany({
      where: { relatedEntityType: "PaperTrade", ruleName: PAPER_TRADE_RULE_NAME, ruleVersion: PAPER_TRADE_RULE_VERSION, evaluationStatus: "evaluated" },
      select: { relatedEntityId: true, outcomeType: true },
    }),
  ]);

  const trades: TradeRow[] = tradeRows.map((t) => ({
    id: t.id,
    strategyType: t.strategyType,
    regime: t.regime,
    symbol: t.symbol,
    direction: t.direction,
    leverage: t.leverage,
    netPnl: Number(t.netPnl),
    returnPct: Number(t.returnPct),
    feesPaid: Number(t.feesPaid),
    fundingPaid: Number(t.fundingPaid),
    closeReason: t.closeReason,
    candidateConfidence: t.candidateConfidence,
    openedAt: t.openedAt,
    closedAt: t.closedAt,
  }));

  const outcomeByTradeId = new Map(outcomeRows.map((o) => [o.relatedEntityId, o.outcomeType]));
  return { trades, outcomeByTradeId };
}

/** Organization-wide paper-trading performance across every strategy/symbol/regime combined. */
export async function getStrategyPerformanceOverall(organizationId: string): Promise<StrategyPerformanceMetrics> {
  const { trades, outcomeByTradeId } = await loadTradesAndOutcomes(organizationId);
  return computeMetrics(trades, outcomeByTradeId);
}

/** Performance broken out per Sprint 15 strategy type (`TREND_FOLLOWING`/`MOMENTUM_CONTINUATION`/`RANGE_MEAN_REVERSION`) -- `NO_TRADE` can never appear (see `loadTradesAndOutcomes`'s own doc comment). */
export async function getStrategyTypePerformance(organizationId: string): Promise<StrategyTypePerformance[]> {
  const { trades, outcomeByTradeId } = await loadTradesAndOutcomes(organizationId);
  const strategyTypes = [...new Set(trades.map((t) => t.strategyType))].sort();
  return strategyTypes.map((strategyType) => ({
    strategyType,
    performance: computeMetrics(
      trades.filter((t) => t.strategyType === strategyType),
      outcomeByTradeId,
    ),
  }));
}

/**
 * Performance broken out by (strategy type × market regime) -- Sprint 17
 * Phase 5's own explicit "aynı stratejinin her piyasa koşulunda aynı
 * çalıştığını varsayma." Regime values are exactly the real, existing
 * `market_regime.v1` vocabulary (`trending`/`ranging`/`high_volatility`/
 * `low_volatility`/`uncertain`), reused verbatim -- never the Turkish
 * spec's illustrative `TRENDING`/`RANGING`/`VOLATILE`/`QUIET` labels, which
 * are examples, not real identifiers in this codebase. A trade whose
 * `regime` was never captured (e.g. the benchmark symbol had no regime
 * signal that run) groups under `"unknown"`, never silently dropped.
 */
export async function getRegimePerformance(organizationId: string): Promise<RegimePerformance[]> {
  const { trades, outcomeByTradeId } = await loadTradesAndOutcomes(organizationId);
  const keys = new Set(trades.map((t) => `${t.strategyType}::${t.regime ?? "unknown"}`));
  return [...keys]
    .sort()
    .map((key) => {
      const [strategyType, regime] = key.split("::") as [string, string];
      return {
        strategyType,
        regime,
        performance: computeMetrics(
          trades.filter((t) => t.strategyType === strategyType && (t.regime ?? "unknown") === regime),
          outcomeByTradeId,
        ),
      };
    });
}

/** Performance broken out per symbol. */
export async function getSymbolPerformance(organizationId: string): Promise<SymbolPerformance[]> {
  const { trades, outcomeByTradeId } = await loadTradesAndOutcomes(organizationId);
  const symbols = [...new Set(trades.map((t) => t.symbol))].sort();
  return symbols.map((symbol) => ({
    symbol,
    performance: computeMetrics(
      trades.filter((t) => t.symbol === symbol),
      outcomeByTradeId,
    ),
  }));
}

/** Performance broken out by LONG vs. SHORT -- proves (or disproves) directional symmetry is actually being measured, not assumed. */
export async function getDirectionPerformance(organizationId: string): Promise<DirectionPerformance[]> {
  const { trades, outcomeByTradeId } = await loadTradesAndOutcomes(organizationId);
  const directions = (["LONG", "SHORT"] as const).filter((d) => trades.some((t) => t.direction === d));
  return directions.map((direction) => ({
    direction,
    performance: computeMetrics(
      trades.filter((t) => t.direction === direction),
      outcomeByTradeId,
    ),
  }));
}

/** Performance broken out by the exact leverage value used (1x/2x/3x/5x/10x -- Sprint 16's own `LEVERAGE_TIERS`). */
export async function getLeverageTierPerformance(organizationId: string): Promise<LeverageTierPerformance[]> {
  const { trades, outcomeByTradeId } = await loadTradesAndOutcomes(organizationId);
  const leverages = [...new Set(trades.map((t) => t.leverage))].sort((a, b) => a - b);
  return leverages.map((leverage) => ({
    leverage,
    performance: computeMetrics(
      trades.filter((t) => t.leverage === leverage),
      outcomeByTradeId,
    ),
  }));
}

/** Paper-trading-scoped confidence calibration -- reuses `learning/service.ts#getConfidenceCalibration`'s own four buckets verbatim (Sprint 17 Phase 8), narrowed via its additive `relatedEntityType` filter. */
export async function getPaperTradeConfidenceCalibration(organizationId: string): Promise<ConfidenceCalibrationBucket[]> {
  return getConfidenceCalibration(organizationId, "PaperTrade");
}

/**
 * The most recent closed `PaperTrade` rows plus each one's evaluated
 * `outcomeResult` (Sprint 17 Phase 12's "Paper Trading Outcomes" UI
 * section) -- `outcomeResult: null` means the hourly `paper_trade_result.v1`
 * evaluation pass hasn't reached this trade yet, never a fabricated
 * verdict. Two queries total (trades, then their outcomes by id), same
 * "avoid N+1" discipline as `loadTradesAndOutcomes`.
 */
export async function getRecentPaperTradeOutcomes(organizationId: string, limit = 25): Promise<PaperTradeOutcomeRow[]> {
  const scoped = getTenantScopedClient(organizationId);
  const trades = await scoped.paperTrade.findMany({
    orderBy: { closedAt: "desc" },
    take: limit,
    select: {
      id: true,
      symbol: true,
      strategyType: true,
      direction: true,
      mode: true,
      regime: true,
      closeReason: true,
      returnPct: true,
      netPnl: true,
      leverage: true,
      closedAt: true,
    },
  });
  const outcomes = await scoped.outcome.findMany({
    where: {
      relatedEntityType: "PaperTrade",
      relatedEntityId: { in: trades.map((t) => t.id) },
      ruleName: PAPER_TRADE_RULE_NAME,
      ruleVersion: PAPER_TRADE_RULE_VERSION,
      evaluationStatus: "evaluated",
    },
    select: { relatedEntityId: true, outcomeType: true },
  });
  const outcomeByTradeId = new Map(outcomes.map((o) => [o.relatedEntityId, o.outcomeType]));

  return trades.map((t) => ({
    id: t.id,
    symbol: t.symbol,
    strategyType: t.strategyType,
    direction: t.direction,
    mode: t.mode,
    regime: t.regime,
    closeReason: t.closeReason,
    returnPct: Number(t.returnPct),
    netPnl: Number(t.netPnl),
    leverage: t.leverage,
    closedAt: t.closedAt.toISOString(),
    outcomeResult: outcomeByTradeId.get(t.id) ?? null,
  }));
}
