import { getTenantScopedClient } from "@/server/db/tenant";
import { getOrCreatePaperAccount, type PaperAccountView } from "@/server/intelligence/paper-trading/account";

export type PaperPositionView = {
  id: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  mode: "SPOT" | "PERPETUAL_SIMULATION";
  status: string;
  strategyType: string;
  leverage: number;
  entryPrice: number;
  currentPrice: number;
  exitPrice: number | null;
  quantity: number;
  notional: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  liquidationPrice: number | null;
  unrealizedPnl: number;
  realizedPnl: number | null;
  feesPaid: number;
  fundingPaid: number;
  maxFavorableExcursion: number;
  maxAdverseExcursion: number;
  openedAt: string;
  closedAt: string | null;
};

export type PaperTradingSnapshot = {
  account: PaperAccountView;
  openPositions: PaperPositionView[];
  closedPositions: PaperPositionView[];
};

/**
 * The single read-only entry point the AI tool and the market-intelligence
 * UI page both call (Sprint 16 Phase 26/27). Reads only what
 * `evaluatePaperTrading` already persisted -- never recomputes P&L, never
 * calls Binance, never calls an LLM. Every value here is a SIMULATED
 * paper-trading figure; see the project README for the explicit PAPER
 * ONLY warning.
 */
export async function getPaperTradingSnapshot(organizationId: string, closedLimit = 20): Promise<PaperTradingSnapshot> {
  const scoped = getTenantScopedClient(organizationId);
  const account = await getOrCreatePaperAccount(organizationId);

  const [openRows, closedRows] = await Promise.all([
    scoped.paperPosition.findMany({ where: { status: "OPEN" }, orderBy: { openedAt: "desc" } }),
    scoped.paperPosition.findMany({
      where: { status: { in: ["CLOSED", "STOPPED", "TAKE_PROFIT", "LIQUIDATED", "INVALIDATED"] } },
      orderBy: { closedAt: "desc" },
      take: closedLimit,
    }),
  ]);

  const toView = (p: (typeof openRows)[number]): PaperPositionView => ({
    id: p.id,
    symbol: p.symbol,
    direction: p.direction,
    mode: p.mode,
    status: p.status,
    strategyType: p.strategyType,
    leverage: p.leverage,
    entryPrice: Number(p.entryPrice),
    currentPrice: Number(p.currentPrice),
    exitPrice: p.exitPrice !== null ? Number(p.exitPrice) : null,
    quantity: Number(p.quantity),
    notional: Number(p.notional),
    stopLossPrice: Number(p.stopLossPrice),
    takeProfitPrice: Number(p.takeProfitPrice),
    liquidationPrice: p.liquidationPrice !== null ? Number(p.liquidationPrice) : null,
    unrealizedPnl: Number(p.unrealizedPnl),
    realizedPnl: p.realizedPnl !== null ? Number(p.realizedPnl) : null,
    feesPaid: Number(p.feesPaid),
    fundingPaid: Number(p.fundingPaid),
    maxFavorableExcursion: Number(p.maxFavorableExcursion),
    maxAdverseExcursion: Number(p.maxAdverseExcursion),
    openedAt: p.openedAt.toISOString(),
    closedAt: p.closedAt ? p.closedAt.toISOString() : null,
  });

  return {
    account,
    openPositions: openRows.map(toView),
    closedPositions: closedRows.map(toView),
  };
}
