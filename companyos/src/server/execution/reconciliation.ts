import type { ExecutionGateway, ExecutionOrderStatus, ExecutionPosition } from "@/server/execution/types";

/**
 * Sprint 22 Phase 10 -- widely considered the single most critical layer
 * of a live execution system: local (this application's own understanding
 * of what orders/positions exist) and remote (the provider's own real
 * source of truth) state can drift apart for many real reasons (a partial
 * network failure during submission, a manual action taken directly on the
 * exchange, a missed webhook/poll, a process restart mid-flight) and the
 * only safe response to ANY detected drift is to STOP opening new risk
 * until a human or a later, successful reconciliation pass resolves it --
 * never to guess, never to "self-heal" by placing a corrective order.
 */

export type ReconciliationMismatch =
  | { type: "unknown_order"; providerOrderId: string; symbol: string }
  | { type: "missing_order"; clientOrderId: string; symbol: string }
  | { type: "quantity_mismatch"; clientOrderId: string; localQuantity: number; providerQuantity: number }
  | { type: "price_mismatch"; clientOrderId: string; localPrice: number | null; providerPrice: number | null }
  | { type: "position_mismatch"; symbol: string; localQuantity: number; providerQuantity: number }
  | { type: "balance_mismatch"; asset: string; localAvailable: number; providerAvailable: number }
  | { type: "stale_order"; clientOrderId: string; ageMs: number }
  | { type: "partial_fill"; clientOrderId: string; filledQuantity: number; totalQuantity: number }
  | { type: "unexpected_close"; clientOrderId: string };

export type ReconciliationResult = {
  /** `true` only when `mismatches` is empty -- deliberately not a separate, independently-settable flag that could drift out of sync with the mismatch list itself. */
  healthy: boolean;
  mismatches: ReconciliationMismatch[];
};

/** How old a locally-`SUBMITTED`-but-not-yet-terminal order may be before it counts as stale (a real, actionable signal that something needs a human's attention -- e.g. it was silently dropped by the provider). */
export const STALE_ORDER_MAX_AGE_MS = 5 * 60 * 1000;

const PRICE_MISMATCH_TOLERANCE_PCT = 0.001; // 0.1% -- floating-point/rounding tolerant, not exact-equality-fragile
const QUANTITY_MISMATCH_TOLERANCE_PCT = 0.0001;

export type LocalOrderSnapshot = {
  clientOrderId: string;
  providerOrderId: string | null;
  symbol: string;
  quantity: number;
  price: number | null;
  status: ExecutionOrderStatus;
  filledQuantity: number;
  requestedAt: Date;
};

export type LocalPositionSnapshot = { symbol: string; quantity: number };

/** This organization's own expected available balance for one asset -- e.g. `PaperAccount.availableMargin`/a live account's own locally-tracked ledger. Compared against the SAME gateway's own `getBalances()` read. */
export type LocalBalanceSnapshot = { asset: string; available: number };

function isNonTerminal(status: ExecutionOrderStatus): boolean {
  return status === "SUBMITTED" || status === "PARTIALLY_FILLED" || status === "SUBMITTING" || status === "CANCEL_REQUESTED";
}

function relativeDiffExceeds(a: number, b: number, tolerancePct: number): boolean {
  const denom = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return Math.abs(a - b) / denom > tolerancePct;
}

/**
 * Compares this organization's locally-tracked, still-open `LiveOrder`
 * rows and open positions against the SAME gateway's own live reads
 * (`getOpenOrders`/`getOpenPositions`) -- the gateway is deliberately the
 * only source of "remote truth" this function reads, never a second,
 * independently-maintained cache of provider state.
 */
export async function reconcile(params: {
  gateway: ExecutionGateway;
  localOrders: LocalOrderSnapshot[];
  localPositions: LocalPositionSnapshot[];
  /** Optional -- omitted entirely means "not checked" (e.g. a caller that only cares about order/position drift), never silently treated as "balance is zero." */
  localBalances?: LocalBalanceSnapshot[];
  now?: Date;
}): Promise<ReconciliationResult> {
  const { gateway, localOrders, localPositions, localBalances } = params;
  const now = params.now ?? new Date();
  const mismatches: ReconciliationMismatch[] = [];

  const [remoteOrders, remotePositions] = await Promise.all([gateway.getOpenOrders(), gateway.getOpenPositions()]);
  const remoteByClientId = new Map(remoteOrders.map((o) => [o.clientOrderId, o]));
  const localByClientId = new Map(localOrders.map((o) => [o.clientOrderId, o]));

  // Unknown: exists remotely but not in our locally-tracked open-order set.
  for (const remote of remoteOrders) {
    if (!localByClientId.has(remote.clientOrderId)) {
      mismatches.push({ type: "unknown_order", providerOrderId: remote.providerOrderId ?? remote.clientOrderId, symbol: remote.symbol });
    }
  }

  for (const local of localOrders) {
    if (!isNonTerminal(local.status)) continue;
    const remote = remoteByClientId.get(local.clientOrderId);

    if (!remote) {
      // We think it's still open; the provider's open-orders list has no
      // record of it. Disambiguate via a direct lookup rather than
      // guessing which of the two real possibilities this is: `null` means
      // the provider genuinely never received/recorded it (`missing_order`
      // -- safe-ish, nothing to reconcile against, but still reportable);
      // any real order back means it already reached a terminal state we
      // haven't observed yet (`unexpected_close`).
      const detail = await gateway.getOrder(local.clientOrderId, local.symbol);
      if (!detail) {
        mismatches.push({ type: "missing_order", clientOrderId: local.clientOrderId, symbol: local.symbol });
      } else {
        mismatches.push({ type: "unexpected_close", clientOrderId: local.clientOrderId });
      }
      continue;
    }

    if (relativeDiffExceeds(local.quantity, remote.quantity, QUANTITY_MISMATCH_TOLERANCE_PCT)) {
      mismatches.push({ type: "quantity_mismatch", clientOrderId: local.clientOrderId, localQuantity: local.quantity, providerQuantity: remote.quantity });
    }
    if (local.price !== null && remote.price !== null && relativeDiffExceeds(local.price, remote.price, PRICE_MISMATCH_TOLERANCE_PCT)) {
      mismatches.push({ type: "price_mismatch", clientOrderId: local.clientOrderId, localPrice: local.price, providerPrice: remote.price });
    }
    if (remote.status === "PARTIALLY_FILLED" && remote.filledQuantity !== local.filledQuantity) {
      mismatches.push({ type: "partial_fill", clientOrderId: local.clientOrderId, filledQuantity: remote.filledQuantity, totalQuantity: remote.quantity });
    }

    const ageMs = now.getTime() - local.requestedAt.getTime();
    if (ageMs > STALE_ORDER_MAX_AGE_MS) {
      mismatches.push({ type: "stale_order", clientOrderId: local.clientOrderId, ageMs });
    }
  }

  const localPositionBySymbol = new Map(localPositions.map((p) => [p.symbol, p]));
  const remotePositionBySymbol = new Map(remotePositions.map((p: ExecutionPosition) => [p.symbol, p]));
  const allSymbols = new Set([...localPositionBySymbol.keys(), ...remotePositionBySymbol.keys()]);
  for (const symbol of allSymbols) {
    const local = localPositionBySymbol.get(symbol);
    const remote = remotePositionBySymbol.get(symbol);
    const localQty = local?.quantity ?? 0;
    const remoteQty = remote?.quantity ?? 0;
    if (relativeDiffExceeds(localQty, remoteQty, QUANTITY_MISMATCH_TOLERANCE_PCT)) {
      mismatches.push({ type: "position_mismatch", symbol, localQuantity: localQty, providerQuantity: remoteQty });
    }
  }

  if (localBalances && localBalances.length > 0) {
    const remoteBalances = await gateway.getBalances();
    const remoteByAsset = new Map(remoteBalances.map((b) => [b.asset, b]));
    for (const local of localBalances) {
      const remoteAvailable = remoteByAsset.get(local.asset)?.available ?? 0;
      if (relativeDiffExceeds(local.available, remoteAvailable, QUANTITY_MISMATCH_TOLERANCE_PCT)) {
        mismatches.push({ type: "balance_mismatch", asset: local.asset, localAvailable: local.available, providerAvailable: remoteAvailable });
      }
    }
  }

  return { healthy: mismatches.length === 0, mismatches };
}

/** The single gate every new-order path (Phase 10's own "SAFE STATE'e geç") must check before submitting anything new -- existing position/order management is never blocked by this, only NEW risk. */
export function isSafeToOpenNewOrders(result: ReconciliationResult): boolean {
  return result.healthy;
}
