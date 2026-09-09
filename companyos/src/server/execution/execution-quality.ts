import { getTenantScopedClient } from "@/server/db/tenant";

/**
 * Sprint 29: execution-quality metrics for real, already-persisted
 * `LiveOrder` rows -- slippage, fill rate, and time-to-fill. Every input
 * here (`price`, `averageFillPrice`, `filledQuantity`, `submittedAt`,
 * `filledAt`) has been recorded on `LiveOrder` since Sprint 22/24; this
 * module adds no new persistence and reads no live exchange state --
 * purely deterministic aggregation over rows that already exist.
 *
 * Deliberately does NOT attempt any live position-level P&L or
 * Outcome/Learning bridge (a `LiveOrder` is a per-ORDER row, not a
 * per-round-trip-position one) -- `MarketDecision.proposedOrder`
 * (`intelligence/market-decision/types.ts`) only ever represents a NEW
 * entry, with no exit/close order concept anywhere in the decision engine
 * yet, so there is no real "closed live position" data this codebase can
 * honestly compute a return% from. See the Sprint 29 README section for
 * the full carry-forward note -- this is the same "don't fabricate a
 * result you cannot honestly compute" discipline `portfolio-risk.ts#
 * computePortfolioSnapshot`'s own doc comment already applied by staying
 * PAPER-only rather than blending in `LiveOrder` prematurely.
 */

export type LiveOrderQualityInput = {
  status: string;
  side: string;
  price: number | null;
  averageFillPrice: number | null;
  quantity: number;
  filledQuantity: number;
  submittedAt: Date | null;
  filledAt: Date | null;
};

/**
 * Slippage in basis points between the intended price and the actual
 * quantity-weighted average fill price, signed so that a POSITIVE value
 * always means "cost the organization money" regardless of side: for a
 * BUY, paying MORE than intended is unfavorable; for a SELL, receiving
 * LESS than intended is unfavorable. Returns `null` when either price is
 * unavailable (no intended price recorded, or the order never filled) --
 * never a fabricated 0.
 */
export function computeSlippageBps(order: Pick<LiveOrderQualityInput, "side" | "price" | "averageFillPrice">): number | null {
  if (order.price === null || order.averageFillPrice === null || order.price === 0) return null;
  const rawBps = ((order.averageFillPrice - order.price) / order.price) * 10_000;
  return order.side === "BUY" ? rawBps : -rawBps;
}

/** Milliseconds from submission to first fill -- `null` if either timestamp is missing (never submitted, or never filled). */
export function computeTimeToFillMs(order: Pick<LiveOrderQualityInput, "submittedAt" | "filledAt">): number | null {
  if (!order.submittedAt || !order.filledAt) return null;
  return order.filledAt.getTime() - order.submittedAt.getTime();
}

export type ExecutionQualitySummary = {
  totalOrders: number;
  filledCount: number;
  partiallyFilledCount: number;
  rejectedCount: number;
  failedCount: number;
  cancelledCount: number;
  /** `filledCount / totalOrders` as a percentage, `null` if there are no orders at all -- never a fabricated 0/0. */
  fillRatePct: number | null;
  /** Mean of `computeSlippageBps` across every FILLED/PARTIALLY_FILLED order that has both a price and averageFillPrice -- `null` if none qualify. */
  avgSlippageBps: number | null;
  /** Mean of `computeTimeToFillMs` across every order with both timestamps -- `null` if none qualify. */
  avgTimeToFillMs: number | null;
};

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Pure aggregation -- see `getExecutionQualitySummary` for the tenant-scoped DB read that feeds this. */
export function summarizeExecutionQuality(orders: LiveOrderQualityInput[]): ExecutionQualitySummary {
  const filledCount = orders.filter((o) => o.status === "FILLED").length;
  const partiallyFilledCount = orders.filter((o) => o.status === "PARTIALLY_FILLED").length;
  const rejectedCount = orders.filter((o) => o.status === "REJECTED").length;
  const failedCount = orders.filter((o) => o.status === "FAILED").length;
  const cancelledCount = orders.filter((o) => o.status === "CANCELLED").length;

  const slippages = orders
    .filter((o) => o.status === "FILLED" || o.status === "PARTIALLY_FILLED")
    .map((o) => computeSlippageBps(o))
    .filter((v): v is number => v !== null);

  const timesToFill = orders
    .map((o) => computeTimeToFillMs(o))
    .filter((v): v is number => v !== null);

  return {
    totalOrders: orders.length,
    filledCount,
    partiallyFilledCount,
    rejectedCount,
    failedCount,
    cancelledCount,
    fillRatePct: orders.length > 0 ? (filledCount / orders.length) * 100 : null,
    avgSlippageBps: average(slippages),
    avgTimeToFillMs: average(timesToFill),
  };
}

/** Tenant-scoped read of every `LiveOrder` this organization has ever had, summarized. `LIVE_EXECUTION_ENABLED` stays `false` in every existing deployment, so this returns an all-null/zero summary for an organization that has never had a live order -- never fabricated activity. */
export async function getExecutionQualitySummary(organizationId: string): Promise<ExecutionQualitySummary> {
  const scoped = getTenantScopedClient(organizationId);
  const orders = await scoped.liveOrder.findMany({
    select: { status: true, side: true, price: true, averageFillPrice: true, quantity: true, filledQuantity: true, submittedAt: true, filledAt: true },
  });
  return summarizeExecutionQuality(
    orders.map((o) => ({
      status: o.status,
      side: o.side,
      price: o.price !== null ? Number(o.price) : null,
      averageFillPrice: o.averageFillPrice !== null ? Number(o.averageFillPrice) : null,
      quantity: Number(o.quantity),
      filledQuantity: Number(o.filledQuantity),
      submittedAt: o.submittedAt,
      filledAt: o.filledAt,
    })),
  );
}
