import { ExecutionProviderError, ExecutionTimeoutError, ExecutionUnknownResultError } from "@/server/execution/errors";
import type { ExecutionAccount, ExecutionBalance, ExecutionGateway, ExecutionOrder, ExecutionPosition, OrderIntent, TestOrderResult } from "@/server/execution/types";

/**
 * Sprint 22 Phase 18/19: a test-only, fully in-memory `ExecutionGateway` --
 * NEVER makes a network call, NEVER needs real credentials, and is the ONLY
 * gateway the Sprint 22 test suite uses to exercise `submitOrder`/
 * `cancelOrder`. Mirrors `market-data/mock-client.ts`'s own established
 * "injectable client, offline, deterministic" precedent (Sprint 13) for
 * the execution layer.
 */

export type MockGatewayBehavior = {
  submitOrderOutcome?: "fill" | "reject" | "timeout" | "unknown_result";
  canTrade?: boolean;
  balances?: ExecutionBalance[];
  positions?: ExecutionPosition[];
  openOrders?: ExecutionOrder[];
  mode?: "PAPER" | "LIVE";
  /** Sprint 23: what `testOrder` reports -- defaults to `{ valid: true }`, matching the real Binance test endpoint's happy path. */
  testOrderResult?: TestOrderResult;
};

export type MockExecutionGateway = ExecutionGateway & {
  submittedIntents: OrderIntent[];
  cancelledClientOrderIds: string[];
};

export function createMockExecutionGateway(behavior: MockGatewayBehavior = {}): MockExecutionGateway {
  const submittedIntents: OrderIntent[] = [];
  const cancelledClientOrderIds: string[] = [];

  return {
    providerName: "mock",
    mode: behavior.mode ?? "LIVE",
    submittedIntents,
    cancelledClientOrderIds,

    async getAccount(): Promise<ExecutionAccount> {
      return { mode: behavior.mode ?? "LIVE", providerAccountId: "mock-account", canTrade: behavior.canTrade ?? true };
    },

    async getBalances(): Promise<ExecutionBalance[]> {
      return behavior.balances ?? [{ asset: "USDT", total: 10_000, available: 10_000, locked: 0 }];
    },

    async getOpenPositions(): Promise<ExecutionPosition[]> {
      return behavior.positions ?? [];
    },

    async getOpenOrders(): Promise<ExecutionOrder[]> {
      return behavior.openOrders ?? [];
    },

    async getOrder(clientOrderId: string): Promise<ExecutionOrder | null> {
      return behavior.openOrders?.find((o) => o.clientOrderId === clientOrderId) ?? null;
    },

    async submitOrder(intent: OrderIntent): Promise<ExecutionOrder> {
      submittedIntents.push(intent);
      const outcome = behavior.submitOrderOutcome ?? "fill";
      if (outcome === "timeout") throw new ExecutionTimeoutError(`mock timeout submitting ${intent.clientOrderId}`);
      if (outcome === "unknown_result") throw new ExecutionUnknownResultError(`mock unknown result submitting ${intent.clientOrderId}`);
      if (outcome === "reject") throw new ExecutionProviderError(`mock rejected ${intent.clientOrderId}`, 400);

      return {
        clientOrderId: intent.clientOrderId,
        providerOrderId: `mock-order-${intent.clientOrderId}`,
        symbol: intent.symbol,
        side: intent.side,
        type: intent.type,
        quantity: intent.quantity,
        price: intent.price ?? null,
        status: "FILLED",
        filledQuantity: intent.quantity,
        averageFillPrice: intent.price ?? null,
        rejectionReason: null,
      };
    },

    async cancelOrder(clientOrderId: string): Promise<void> {
      cancelledClientOrderIds.push(clientOrderId);
    },

    async testOrder(): Promise<TestOrderResult> {
      return behavior.testOrderResult ?? { valid: true };
    },
  };
}
