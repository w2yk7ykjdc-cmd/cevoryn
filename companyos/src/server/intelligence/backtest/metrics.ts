import { computeMaxDrawdown, computeRiskAdjustedReturn, evidenceQualityFor } from "@/server/intelligence/strategy-evaluation/service";
import type { DrawdownResult, EvidenceQuality, RiskAdjustedReturn } from "@/server/intelligence/strategy-evaluation/types";
import { MIN_SAMPLE_SIZE } from "@/server/intelligence/backtest/constants";
import type { BacktestTrade } from "@/server/intelligence/backtest/types";

const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Zero-division-safe average -- `null` (never `NaN`/`0`-as-a-lie) when there is nothing to average (Phase 10's own explicit "sıfıra bölme güvenli" requirement). */
function safeAverage(values: number[]): number | null {
  if (values.length === 0) return null;
  return round2(values.reduce((sum, v) => sum + v, 0) / values.length);
}

function safeRate(count: number, total: number): number | null {
  if (total === 0) return null;
  return round2((count / total) * 100);
}

export type BacktestOutcomeMetrics = {
  totalTrades: number;
  winCount: number;
  lossCount: number;
  breakEvenCount: number;
  winRate: number | null;
  totalNetPnl: number;
  totalGrossPnl: number;
  totalFeesPaid: number;
  totalFundingPaid: number;
  averageNetPnl: number | null;
  averageReturnPct: number | null;
  bestTrade: { symbol: string; netPnl: number } | null;
  worstTrade: { symbol: string; netPnl: number } | null;
  /**
   * Gross profit / gross loss magnitude -- `null` when there are no losing
   * trades to divide by (never `Infinity` presented as a real number) and
   * `null` when there are no trades at all. A standard, well-known,
   * non-fabricated ratio; not treated as a verdict on its own (same
   * "supporting evidence, never truth" posture every other ratio in this
   * codebase already takes).
   */
  profitFactor: number | null;
  liquidationRate: number | null;
  stopRate: number | null;
  takeProfitRate: number | null;
  invalidationRate: number | null;
  maxDrawdown: DrawdownResult;
  riskAdjustedReturn: RiskAdjustedReturn;
};

/**
 * Sprint 20 Phase 10: comprehensive, zero-division-safe summary metrics
 * over this backtest run's own closed trades -- reuses Sprint 18's own
 * `computeMaxDrawdown`/`computeRiskAdjustedReturn` (`strategy-evaluation/
 * service.ts`) verbatim rather than re-deriving an equivalent drawdown/
 * Sharpe-like formula a second time. Every trade fed in here is this
 * backtest run's OWN isolated `BacktestTrade[]` -- never mixed with a real
 * `PaperTrade` row (Phase 11's own explicit "backtest ve live/paper
 * sonuçlarını birbirine karıştırma").
 */
export function computeBacktestOutcomeMetrics(trades: BacktestTrade[]): BacktestOutcomeMetrics {
  const totalTrades = trades.length;
  const winCount = trades.filter((t) => t.netPnl > 0).length;
  const lossCount = trades.filter((t) => t.netPnl < 0).length;
  const breakEvenCount = totalTrades - winCount - lossCount;

  const totalNetPnl = round2(trades.reduce((sum, t) => sum + t.netPnl, 0));
  const totalGrossPnl = round2(trades.reduce((sum, t) => sum + t.grossPnl, 0));
  const totalFeesPaid = round2(trades.reduce((sum, t) => sum + t.feesPaid, 0));
  const totalFundingPaid = round2(trades.reduce((sum, t) => sum + t.fundingPaid, 0));

  const grossProfit = trades.filter((t) => t.netPnl > 0).reduce((sum, t) => sum + t.netPnl, 0);
  const grossLoss = Math.abs(trades.filter((t) => t.netPnl < 0).reduce((sum, t) => sum + t.netPnl, 0));

  const best = trades.reduce<BacktestTrade | null>((best, t) => (!best || t.netPnl > best.netPnl ? t : best), null);
  const worst = trades.reduce<BacktestTrade | null>((worst, t) => (!worst || t.netPnl < worst.netPnl ? t : worst), null);

  const drawdownInput = trades.map((t, i) => ({ id: `${t.symbol}:${t.closedAt}:${i}`, closedAt: new Date(t.closedAt), netPnl: t.netPnl }));

  return {
    totalTrades,
    winCount,
    lossCount,
    breakEvenCount,
    winRate: safeRate(winCount, totalTrades),
    totalNetPnl,
    totalGrossPnl,
    totalFeesPaid,
    totalFundingPaid,
    averageNetPnl: safeAverage(trades.map((t) => t.netPnl)),
    averageReturnPct: safeAverage(trades.map((t) => t.returnPct * 100)),
    bestTrade: best ? { symbol: best.symbol, netPnl: best.netPnl } : null,
    worstTrade: worst ? { symbol: worst.symbol, netPnl: worst.netPnl } : null,
    profitFactor: totalTrades === 0 ? null : grossLoss === 0 ? null : round2(grossProfit / grossLoss),
    liquidationRate: safeRate(trades.filter((t) => t.closeReason === "LIQUIDATED").length, totalTrades),
    stopRate: safeRate(trades.filter((t) => t.closeReason === "STOPPED").length, totalTrades),
    takeProfitRate: safeRate(trades.filter((t) => t.closeReason === "TAKE_PROFIT").length, totalTrades),
    invalidationRate: safeRate(trades.filter((t) => t.closeReason === "INVALIDATED").length, totalTrades),
    maxDrawdown: computeMaxDrawdown(drawdownInput),
    riskAdjustedReturn: computeRiskAdjustedReturn(trades.map((t) => t.returnPct)),
  };
}

export type BacktestRobustnessBucket = {
  key: string;
  evaluatedTrades: number;
  evidenceQuality: EvidenceQuality;
  winRate: number | null;
  averageReturnPct: number | null;
  totalNetPnl: number;
};

function bucketBy(trades: BacktestTrade[], keyFor: (t: BacktestTrade) => string): BacktestRobustnessBucket[] {
  const groups = new Map<string, BacktestTrade[]>();
  for (const trade of trades) {
    const key = keyFor(trade);
    const group = groups.get(key) ?? [];
    group.push(trade);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([key, group]) => ({
      key,
      evaluatedTrades: group.length,
      evidenceQuality: evidenceQualityFor(group.length),
      winRate: safeRate(group.filter((t) => t.netPnl > 0).length, group.length),
      averageReturnPct: safeAverage(group.map((t) => t.returnPct * 100)),
      totalNetPnl: round2(group.reduce((sum, t) => sum + t.netPnl, 0)),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export type BacktestRobustness = {
  byStrategyType: BacktestRobustnessBucket[];
  byRegime: BacktestRobustnessBucket[];
  bySymbol: BacktestRobustnessBucket[];
  byDirection: BacktestRobustnessBucket[];
  byLeverage: BacktestRobustnessBucket[];
};

/**
 * Sprint 20 Phase 11: robustness breakdowns in the SAME shape family Sprint
 * 18's `StrategyEvaluation` already established (`evidenceQuality` per
 * bucket via the same `evidenceQualityFor`/`MIN_SAMPLE_SIZE` gate) so a
 * reader familiar with Sprint 18's evaluation page immediately recognizes
 * the convention here -- but this is explicitly BACKTEST/HISTORICAL data,
 * a completely separate, isolated computation over this run's own
 * `BacktestTrade[]`, never unioned with real `PaperTrade` rows and never
 * written back into the real `StrategyEvaluation` used for live ranking.
 */
export function computeBacktestRobustness(trades: BacktestTrade[]): BacktestRobustness {
  return {
    byStrategyType: bucketBy(trades, (t) => t.strategyType),
    byRegime: bucketBy(trades, (t) => t.regime ?? "unknown"),
    bySymbol: bucketBy(trades, (t) => t.symbol),
    byDirection: bucketBy(trades, (t) => t.direction),
    byLeverage: bucketBy(trades, (t) => `${t.leverage}x`),
  };
}

export { MIN_SAMPLE_SIZE };
