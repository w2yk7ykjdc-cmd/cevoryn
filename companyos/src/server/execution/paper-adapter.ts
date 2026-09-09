import { prisma } from "@/server/db/client";
import { getTenantScopedClient } from "@/server/db/tenant";
import { getOrCreatePaperAccount } from "@/server/intelligence/paper-trading/account";
import { computeSimulatedLiquidationPrice } from "@/server/intelligence/paper-trading/sizing";
import { computeFee } from "@/server/intelligence/paper-trading/pnl";
import type {
  ExecutionAccount,
  ExecutionBalance,
  ExecutionGateway,
  ExecutionOrder,
  ExecutionPosition,
  OrderIntent,
  TestOrderResult,
} from "@/server/execution/types";

/**
 * Sprint 22 Phase 12 (paper/live parity): the PAPER `ExecutionGateway`
 * implementation -- reuses Sprint 16's own PaperAccount/PaperPosition
 * persistence and formulas VERBATIM (`getOrCreatePaperAccount`,
 * `computeSimulatedLiquidationPrice`, `computeFee`), never a second,
 * parallel paper-trading system. The existing recurring
 * `evaluate-paper-trading` job (Sprint 16, unmodified) remains the primary
 * way paper positions open/close in production; this adapter exists so
 * the SAME shared Decision -> Validation -> Order Plan -> Risk pipeline
 * (Phase 12) this sprint introduces can also express "and now make it
 * real" for paper, symmetrically with `BinanceExecutionAdapter`.
 *
 * Paper fills are always instant and complete (matching Sprint 16's own
 * existing behavior -- there is no partial-fill or pending-order concept
 * in the paper simulation), so `getOpenOrders()` is always empty and
 * `getOrder()` always returns `null`: an "order" is not a distinct,
 * queryable paper entity, only the `PaperPosition` it immediately became
 * is. `cancelOrder()` always throws for the same reason -- there is
 * nothing pending to cancel.
 */
export function createPaperExecutionAdapter(organizationId: string): ExecutionGateway {
  return {
    providerName: "paper",
    mode: "PAPER",

    async getAccount(): Promise<ExecutionAccount> {
      const account = await getOrCreatePaperAccount(organizationId);
      return { mode: "PAPER", providerAccountId: account.id, canTrade: true };
    },

    async getBalances(): Promise<ExecutionBalance[]> {
      const account = await getOrCreatePaperAccount(organizationId);
      return [{ asset: "USDT", total: account.currentEquity, available: account.availableMargin, locked: account.usedMargin }];
    },

    async getOpenPositions(): Promise<ExecutionPosition[]> {
      const scoped = getTenantScopedClient(organizationId);
      const positions = await scoped.paperPosition.findMany({ where: { status: "OPEN" } });
      return positions.map((p) => ({
        symbol: p.symbol,
        side: p.direction,
        quantity: Number(p.quantity),
        entryPrice: Number(p.entryPrice),
        markPrice: Number(p.currentPrice),
        unrealizedPnl: Number(p.unrealizedPnl),
        leverage: p.leverage,
      }));
    },

    async getOpenOrders(): Promise<ExecutionOrder[]> {
      return [];
    },

    async getOrder(): Promise<ExecutionOrder | null> {
      return null;
    },

    async submitOrder(intent: OrderIntent): Promise<ExecutionOrder> {
      if (!intent.price || intent.price <= 0) {
        throw new Error("PaperExecutionAdapter.submitOrder requires a concrete fill price (the current market price at submission time)");
      }
      const entryPrice = intent.price;
      const direction = intent.side === "BUY" ? "LONG" : "SHORT";
      const leverage = intent.leverage && intent.leverage > 1 ? intent.leverage : 1;
      const mode = leverage > 1 ? "PERPETUAL_SIMULATION" : "SPOT";
      const notional = intent.quantity * entryPrice;
      const initialMargin = notional / leverage;
      const entryFee = computeFee(notional);
      const liquidationPrice = mode === "SPOT" ? null : computeSimulatedLiquidationPrice(entryPrice, leverage, direction);

      const account = await getOrCreatePaperAccount(organizationId);

      await prisma.$transaction(async (tx) => {
        await tx.paperPosition.create({
          data: {
            organizationId,
            accountId: account.id,
            symbol: intent.symbol,
            direction,
            mode,
            status: "OPEN",
            strategyType: intent.strategyType,
            strategySignalId: null,
            regime: null,
            candidateScore: null,
            candidateConfidence: null,
            leverage,
            entryPrice,
            currentPrice: entryPrice,
            quantity: intent.quantity,
            notional,
            initialMargin,
            stopLossPrice: intent.stopLossPrice ?? (direction === "LONG" ? entryPrice * 0.99 : entryPrice * 1.01),
            takeProfitPrice: intent.takeProfitPrice ?? (direction === "LONG" ? entryPrice * 1.02 : entryPrice * 0.98),
            liquidationPrice,
            riskUnit: 1,
            unrealizedPnl: -entryFee,
            feesPaid: entryFee,
            fundingPaid: 0,
            maxFavorableExcursion: -entryFee,
            maxAdverseExcursion: -entryFee,
            lastFundingAt: new Date(),
            openedAt: new Date(),
          },
        });
        await tx.paperAccount.update({ where: { organizationId }, data: { totalFees: { increment: entryFee } } });
      });

      return {
        clientOrderId: intent.clientOrderId,
        providerOrderId: null,
        symbol: intent.symbol,
        side: intent.side,
        type: intent.type,
        quantity: intent.quantity,
        price: entryPrice,
        status: "FILLED",
        filledQuantity: intent.quantity,
        averageFillPrice: entryPrice,
        rejectionReason: null,
      };
    },

    async cancelOrder(): Promise<void> {
      throw new Error("PaperExecutionAdapter has no pending orders to cancel -- paper fills are always instant");
    },

    /**
     * PAPER has no real provider to validate against -- the same basic
     * shape check `submitOrder` itself would fail on (a concrete price) is
     * reused here rather than always trivially returning `valid: true`,
     * so a caller that runs readiness checks against a paper gateway still
     * gets a meaningful, non-fabricated answer.
     */
    async testOrder(intent: OrderIntent): Promise<TestOrderResult> {
      if (!intent.price || intent.price <= 0) return { valid: false, reason: "PaperExecutionAdapter requires a concrete fill price" };
      if (intent.quantity <= 0) return { valid: false, reason: "quantity must be positive" };
      return { valid: true };
    },
  };
}
