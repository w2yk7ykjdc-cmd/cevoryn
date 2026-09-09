import { logger } from "@/server/logger/logger";
import type { BinanceCredentials } from "@/server/execution/credentials";
import { binancePrivateDelete, binancePrivateGet, binancePrivatePost, binancePrivateTestOrder } from "@/server/execution/binance-private-client";
import { ExecutionProviderError } from "@/server/execution/errors";
import { env } from "@/env";
import type {
  ExecutionAccount,
  ExecutionBalance,
  ExecutionGateway,
  ExecutionOrder,
  ExecutionOrderStatus,
  ExecutionPosition,
  OrderIntent,
  TestOrderResult,
} from "@/server/execution/types";

/**
 * Sprint 22 Phase 2/5: the LIVE `ExecutionGateway` implementation --
 * SPOT-account-only this sprint (`/api/v3/*`), a deliberate, documented
 * scope boundary: Binance's leveraged USDⓈ-M futures account is a
 * genuinely separate API surface (`fapi.binance.com`, its own auth/order/
 * position endpoints), and implementing it without a real account to
 * verify against would mean shipping unverified, unverifiable code --
 * exactly what the sprint's own "dürüstçe raporla" discipline forbids.
 * `getOpenPositions()` therefore honestly returns `[]` with a code comment
 * explaining why, never a fabricated position. `PaperPosition`'s own
 * `PERPETUAL_SIMULATION` leverage/liquidation modeling remains
 * SIMULATION-ONLY; nothing here claims to reproduce it live.
 *
 * Every write method (`submitOrder`/`cancelOrder`) checks
 * `env.LIVE_EXECUTION_ENABLED` FIRST, before doing anything else --
 * defense in depth alongside `execution/live-mode-gate.ts`'s own check
 * (Phase 13), so this adapter can never be accidentally wired up and used
 * to submit a real order even if some future caller forgets the gate.
 */

function mapBinanceOrderStatus(status: string): ExecutionOrderStatus {
  switch (status) {
    case "NEW":
      return "SUBMITTED";
    case "PARTIALLY_FILLED":
      return "PARTIALLY_FILLED";
    case "FILLED":
      return "FILLED";
    case "PENDING_CANCEL":
      return "CANCEL_REQUESTED";
    case "CANCELED":
      return "CANCELLED";
    case "REJECTED":
      return "REJECTED";
    case "EXPIRED":
      return "FAILED";
    default:
      return "FAILED";
  }
}

function assertLiveExecutionEnabled(action: string): void {
  if (!env.LIVE_EXECUTION_ENABLED) {
    throw new Error(`LIVE_EXECUTION_ENABLED is false -- refusing to ${action}. This is an intentional, hard-coded safety gate (Sprint 22 Phase 13).`);
  }
}

type RawAccount = { accountType?: string; canTrade?: boolean; balances?: { asset: string; free: string; locked: string }[] };
type RawOrder = {
  clientOrderId?: string;
  orderId?: number;
  symbol?: string;
  side?: string;
  type?: string;
  origQty?: string;
  price?: string;
  status?: string;
  executedQty?: string;
  cummulativeQuoteQty?: string;
};

function toExecutionOrder(raw: RawOrder): ExecutionOrder {
  const quantity = Number(raw.origQty ?? 0);
  const filledQuantity = Number(raw.executedQty ?? 0);
  const cumulativeQuote = Number(raw.cummulativeQuoteQty ?? 0);
  return {
    clientOrderId: raw.clientOrderId ?? "",
    providerOrderId: raw.orderId !== undefined ? String(raw.orderId) : null,
    symbol: raw.symbol ?? "",
    side: raw.side === "SELL" ? "SELL" : "BUY",
    type: raw.type === "LIMIT" ? "LIMIT" : "MARKET",
    quantity,
    price: raw.price !== undefined && Number(raw.price) > 0 ? Number(raw.price) : null,
    status: mapBinanceOrderStatus(raw.status ?? ""),
    filledQuantity,
    averageFillPrice: filledQuantity > 0 ? cumulativeQuote / filledQuantity : null,
    rejectionReason: raw.status === "REJECTED" ? "rejected by Binance" : null,
  };
}

/**
 * Sprint 23: `credentials` is now REQUIRED, no env-fallback default --
 * organization-scoped credential resolution (`org-credentials.ts#resolveExecutionCredentials`)
 * happens at the CALL SITE, before this adapter is ever constructed, so the
 * adapter itself never has to know or guess which organization it is
 * acting for. This is a deliberate tightening: the previous
 * `= getCredentials()` default silently read the deployment-wide env vars
 * if a caller forgot to pass credentials, which is exactly the kind of
 * implicit cross-organization behavior Sprint 23's own isolation
 * requirement rules out.
 */
export function createBinanceExecutionAdapter(credentials: BinanceCredentials): ExecutionGateway {
  return {
    providerName: "binance",
    mode: "LIVE",

    async getAccount(): Promise<ExecutionAccount> {
      const raw = (await binancePrivateGet("/api/v3/account", {}, credentials)) as RawAccount;
      return { mode: "LIVE", providerAccountId: null, canTrade: raw.canTrade ?? false };
    },

    async getBalances(): Promise<ExecutionBalance[]> {
      const raw = (await binancePrivateGet("/api/v3/account", {}, credentials)) as RawAccount;
      return (raw.balances ?? [])
        .map((b) => ({ asset: b.asset, total: Number(b.free) + Number(b.locked), available: Number(b.free), locked: Number(b.locked) }))
        .filter((b) => b.total > 0);
    },

    async getOpenPositions(): Promise<ExecutionPosition[]> {
      // SPOT account: no leveraged position concept -- see this file's own
      // top-level doc comment for why USDⓈ-M futures live positions are
      // deliberately, honestly out of scope this sprint rather than
      // approximated.
      return [];
    },

    async getOpenOrders(): Promise<ExecutionOrder[]> {
      const raw = (await binancePrivateGet("/api/v3/openOrders", {}, credentials)) as RawOrder[];
      return raw.map(toExecutionOrder);
    },

    async getOrder(clientOrderId: string, symbol: string): Promise<ExecutionOrder | null> {
      try {
        const raw = (await binancePrivateGet("/api/v3/order", { origClientOrderId: clientOrderId, symbol }, credentials)) as RawOrder;
        return toExecutionOrder(raw);
      } catch (err) {
        if (err instanceof ExecutionProviderError && err.status === 400) return null; // Binance's own "order does not exist" shape
        throw err;
      }
    },

    async submitOrder(intent: OrderIntent): Promise<ExecutionOrder> {
      assertLiveExecutionEnabled(`submit order ${intent.clientOrderId}`);
      logger.warn({ clientOrderId: intent.clientOrderId, symbol: intent.symbol }, "binance-adapter: submitting a REAL live order");

      const raw = (await binancePrivatePost("/api/v3/order", buildOrderParams(intent), credentials)) as RawOrder;
      return toExecutionOrder(raw);
    },

    async cancelOrder(clientOrderId: string, symbol: string): Promise<void> {
      assertLiveExecutionEnabled(`cancel order ${clientOrderId}`);
      await binancePrivateDelete("/api/v3/order", { origClientOrderId: clientOrderId, symbol }, credentials);
    },

    /**
     * Sprint 23 Phase 3: Binance's own `/api/v3/order/test` endpoint --
     * validates signature/params/symbol/filters against the real matching
     * engine's own rules but NEVER creates an order or moves a balance
     * (documented Binance behavior, not an assumption this codebase makes).
     * Deliberately NOT gated by `assertLiveExecutionEnabled`: gating it
     * would make it impossible to verify the test-order pathway as part of
     * `checkLiveModeReadiness` BEFORE live execution is ever enabled,
     * defeating the entire point of a pre-activation readiness check.
     */
    async testOrder(intent: OrderIntent): Promise<TestOrderResult> {
      try {
        await binancePrivateTestOrder("/api/v3/order/test", buildOrderParams(intent), credentials);
        return { valid: true };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return { valid: false, reason };
      }
    },
  };
}

function buildOrderParams(intent: OrderIntent): Record<string, string | number> {
  const params: Record<string, string | number> = {
    symbol: intent.symbol,
    side: intent.side,
    type: intent.type,
    quantity: intent.quantity,
    newClientOrderId: intent.clientOrderId,
  };
  if (intent.type === "LIMIT") {
    if (!intent.price) throw new Error("LIMIT order requires a price");
    params.price = intent.price;
    params.timeInForce = "GTC";
  }
  return params;
}
