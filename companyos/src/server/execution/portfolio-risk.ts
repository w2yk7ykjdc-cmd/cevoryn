import { getTenantScopedClient } from "@/server/db/tenant";
import { getOrCreatePaperAccount, type PaperAccountView } from "@/server/intelligence/paper-trading/account";

/**
 * Sprint 24 Phase 4: portfolio-level risk metrics -- reads REAL, already-
 * persisted `PaperPosition`/`PaperTrade`/`PaperAccount` rows (Sprint 16),
 * never a second, parallel exposure-tracking system. This is also the
 * canonical "build the current risk-context state" function Sprint 22's
 * `validateForLiveExecution`/`checkRiskLimits` always REQUIRED as an input
 * (`riskContext`) but never itself computed anywhere in the codebase --
 * every prior sprint's tests built it by hand. `computePortfolioSnapshot`
 * is that missing, real computation.
 *
 * Scoped to PAPER data specifically: `LiveOrder`/live positions are
 * intentionally out of scope here (no live position has ever existed --
 * `LIVE_EXECUTION_ENABLED` stays `false` through this sprint too), and
 * mixing paper and live exposure into one number would misrepresent both.
 * A future sprint that activates live execution would add a symmetric
 * `computeLivePortfolioSnapshot` reading `LiveOrder`/`gateway.getOpenPositions()`
 * instead, never blended with paper state.
 */

export type SymbolExposure = { symbol: string; notional: number };
export type StrategyExposure = { strategyType: string; notional: number };

export type PortfolioSnapshot = {
  account: PaperAccountView;
  openPositionCount: number;
  /** Sum of every open position's notional -- always positive (a magnitude), matching `MAX_TOTAL_EXPOSURE_MULTIPLE`'s own existing "aggregate notional exposure" semantics (Sprint 16). */
  totalExposure: number;
  /** Identical to `totalExposure` here since every position's notional is already a positive magnitude -- gross exposure (sum of |notional|) and total exposure coincide for this codebase's existing position model. Kept as a separate, named field because "gross exposure" is the standard portfolio-risk term reviewers will look for. */
  grossExposure: number;
  /** Sum of SIGNED notional (LONG positive, SHORT negative) -- the portfolio's real net directional bias, which `grossExposure` alone cannot show (a fully-hedged LONG+SHORT book has high gross but zero net exposure). */
  netExposure: number;
  marginUtilization: number;
  bySymbol: SymbolExposure[];
  byStrategy: StrategyExposure[];
  /** Today's realized loss as a fraction of the account's CURRENT equity (0 if today was flat or profitable) -- "today" is this process's own UTC calendar day, matching `AutonomousActionLog`/other daily-scoped reads' own existing UTC-boundary convention. */
  todaysRealizedLossPct: number;
  /** Count of the most recent consecutively-closed LOSING trades, walking backward from the most recent close and stopping at the first winner (or breakeven) -- resets to 0 the moment a non-losing trade closes. */
  consecutiveLosses: number;
};

function existingExposureFor(symbol: string | null, strategyType: string | null, bySymbol: SymbolExposure[], byStrategy: StrategyExposure[]): number {
  if (symbol) return bySymbol.find((s) => s.symbol === symbol)?.notional ?? 0;
  if (strategyType) return byStrategy.find((s) => s.strategyType === strategyType)?.notional ?? 0;
  return 0;
}

export async function computePortfolioSnapshot(organizationId: string): Promise<PortfolioSnapshot> {
  const scoped = getTenantScopedClient(organizationId);
  const account = await getOrCreatePaperAccount(organizationId);

  const openPositions = await scoped.paperPosition.findMany({ where: { organizationId, status: "OPEN" } });

  const bySymbolMap = new Map<string, number>();
  const byStrategyMap = new Map<string, number>();
  let grossExposure = 0;
  let netExposure = 0;

  for (const p of openPositions) {
    const notional = Number(p.notional);
    grossExposure += notional;
    netExposure += p.direction === "LONG" ? notional : -notional;
    bySymbolMap.set(p.symbol, (bySymbolMap.get(p.symbol) ?? 0) + notional);
    byStrategyMap.set(p.strategyType, (byStrategyMap.get(p.strategyType) ?? 0) + notional);
  }

  const bySymbol: SymbolExposure[] = Array.from(bySymbolMap.entries()).map(([symbol, notional]) => ({ symbol, notional }));
  const byStrategy: StrategyExposure[] = Array.from(byStrategyMap.entries()).map(([strategyType, notional]) => ({ strategyType, notional }));

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todaysTrades = await scoped.paperTrade.findMany({ where: { organizationId, closedAt: { gte: todayStart } }, select: { netPnl: true } });
  const todaysRealizedPnl = todaysTrades.reduce((sum, t) => sum + Number(t.netPnl), 0);
  const todaysRealizedLossPct = account.currentEquity > 0 && todaysRealizedPnl < 0 ? Math.abs(todaysRealizedPnl) / account.currentEquity : 0;

  const recentTrades = await scoped.paperTrade.findMany({ where: { organizationId }, orderBy: { closedAt: "desc" }, take: 50, select: { netPnl: true } });
  let consecutiveLosses = 0;
  for (const t of recentTrades) {
    if (Number(t.netPnl) < 0) consecutiveLosses += 1;
    else break;
  }

  return {
    account,
    openPositionCount: openPositions.length,
    totalExposure: grossExposure,
    grossExposure,
    netExposure,
    marginUtilization: account.currentEquity > 0 ? account.usedMargin / account.currentEquity : 0,
    bySymbol,
    byStrategy,
    todaysRealizedLossPct,
    consecutiveLosses,
  };
}

export { existingExposureFor };
