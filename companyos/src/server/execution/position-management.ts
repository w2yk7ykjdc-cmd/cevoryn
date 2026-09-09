import { getTenantScopedClient } from "@/server/db/tenant";
import { recordExecutionAudit } from "@/server/execution/audit";
import { reconcile, isSafeToOpenNewOrders, type LocalOrderSnapshot, type ReconciliationResult } from "@/server/execution/reconciliation";
import type { ExecutionGateway, ExecutionOrderStatus } from "@/server/execution/types";

/**
 * Sprint 23 Phase 4: kill-switch-safe management of ALREADY-OPEN live
 * risk. Sprint 22's `validation.ts#validateForLiveExecution` already
 * blocks every NEW submission while either kill switch is engaged
 * (unconditionally, regardless of provider mode) -- that check is untouched
 * and still the only gate `service.ts#submitDecision` goes through.
 *
 * This module is deliberately SEPARATE from that submission path: reducing
 * or monitoring existing risk (cancelling a still-open order, reconciling
 * local state against the provider) is never itself a new-exposure action,
 * so it is never gated by the kill switch here -- exactly the spec's own
 * "Mevcut pozisyonların state/reconciliation/exit management akışının
 * güvenli şekilde devam edebilmesini sağla" requirement. Neither function
 * here EVER opens a new position or increases quantity on an existing one;
 * `cancelExistingLiveOrder` can only ever reduce or fully remove an
 * already-tracked order, never create one.
 *
 * Just as deliberately, NEITHER function auto-closes a position when the
 * kill switch engages -- the spec explicitly forbids that ("Kill switch'in
 * mevcut pozisyonları otomatik olarak kapatması gibi tehlikeli davranış
 * ekleme"). A human (or a future, explicitly-authorized automation) decides
 * when to call `cancelExistingLiveOrder`; this module only makes doing so
 * safe and auditable, it never decides to on its own.
 */

export class LiveOrderNotFoundError extends Error {
  constructor(clientOrderId: string) {
    super(`No LiveOrder found for clientOrderId "${clientOrderId}" in this organization`);
    this.name = "LiveOrderNotFoundError";
  }
}

export class LiveOrderNotCancellableError extends Error {
  constructor(clientOrderId: string, status: string) {
    super(`LiveOrder "${clientOrderId}" is already terminal (status: ${status}) -- nothing to cancel`);
    this.name = "LiveOrderNotCancellableError";
  }
}

const CANCELLABLE_STATUSES = new Set(["SUBMITTED", "PARTIALLY_FILLED"]);

/**
 * Cancels an already-submitted, still-open `LiveOrder` -- NEVER gated by
 * either kill switch (cancelling only ever reduces risk). Tenant-scoped:
 * looking up another organization's `clientOrderId` throws
 * `CrossTenantAccessError` via `getTenantScopedClient`, never silently
 * cancels the wrong organization's order.
 */
export async function cancelExistingLiveOrder(params: { organizationId: string; gateway: ExecutionGateway; clientOrderId: string }): Promise<void> {
  const { organizationId, gateway, clientOrderId } = params;
  const scoped = getTenantScopedClient(organizationId);

  const order = await scoped.liveOrder.findUnique({ where: { organizationId_clientOrderId: { organizationId, clientOrderId } } });
  if (!order) throw new LiveOrderNotFoundError(clientOrderId);
  if (!CANCELLABLE_STATUSES.has(order.status)) throw new LiveOrderNotCancellableError(clientOrderId, order.status);

  await scoped.liveOrder.update({ where: { organizationId_clientOrderId: { organizationId, clientOrderId } }, data: { status: "CANCEL_REQUESTED" } });
  await recordExecutionAudit({ organizationId, action: "execution.order_cancel_requested", clientOrderId, symbol: order.symbol });

  await gateway.cancelOrder(clientOrderId, order.symbol);

  await scoped.liveOrder.update({ where: { organizationId_clientOrderId: { organizationId, clientOrderId } }, data: { status: "CANCELLED", cancelledAt: new Date() } });
  await recordExecutionAudit({ organizationId, action: "execution.order_cancelled", clientOrderId, symbol: order.symbol });
}

/**
 * Reconciles this organization's own still-open `LiveOrder` rows against
 * the SAME gateway's live reads -- read-only, always allowed regardless of
 * kill switch state (monitoring is never itself new exposure). Reuses
 * Sprint 22's `reconcile()` verbatim; the only new work here is loading
 * THIS organization's own non-terminal rows in a tenant-scoped way and
 * shaping them into `LocalOrderSnapshot`s.
 *
 * Sprint 24 Phase 7 closes the gap Sprint 23 honestly documented here: the
 * REAL, persisted `LiveOrder.filledQuantity` is now used (previously always
 * `0`). Detecting drift is unchanged (still `reconcile()`, read-only); the
 * NEW additive capability is `syncOrderFillFromProvider` below, which a
 * caller invokes explicitly to correct local state after a detected
 * `partial_fill`/`unexpected_close` mismatch -- reconciliation ITSELF still
 * never mutates anything on its own, preserving Sprint 22's own "detect,
 * never self-heal by guessing" discipline.
 */
export async function reconcileOrganizationLiveState(params: { organizationId: string; gateway: ExecutionGateway }): Promise<ReconciliationResult> {
  const { organizationId, gateway } = params;
  const scoped = getTenantScopedClient(organizationId);

  const openOrders = await scoped.liveOrder.findMany({
    where: { organizationId, status: { in: ["SUBMITTED", "PARTIALLY_FILLED", "SUBMITTING", "CANCEL_REQUESTED"] } },
  });

  const localOrders: LocalOrderSnapshot[] = openOrders.map((o) => ({
    clientOrderId: o.clientOrderId,
    providerOrderId: o.providerOrderId,
    symbol: o.symbol,
    quantity: Number(o.quantity),
    price: o.price !== null ? Number(o.price) : null,
    status: o.status,
    filledQuantity: Number(o.filledQuantity),
    requestedAt: o.requestedAt,
  }));

  const result = await reconcile({ gateway, localOrders, localPositions: [] });

  if (!result.healthy) {
    for (const mismatch of result.mismatches) {
      const clientOrderId = "clientOrderId" in mismatch ? mismatch.clientOrderId : organizationId;
      await recordExecutionAudit({
        organizationId,
        action: "execution.reconciliation_mismatch",
        clientOrderId,
        symbol: "symbol" in mismatch ? mismatch.symbol : "n/a",
        metadata: { mismatchType: mismatch.type },
      });
    }
  } else {
    await recordExecutionAudit({ organizationId, action: "execution.position_reconciled", clientOrderId: organizationId, symbol: "n/a" });
  }

  return result;
}

/**
 * Sprint 24 Phase 7: applies an absolute (never incremental) fill update to
 * a `LiveOrder` row -- idempotent by construction: calling this twice with
 * the SAME `filledQuantity`/`averageFillPrice`/`status` produces the exact
 * same row state both times and only audits once (Phase 11's own "partial
 * fill duplicate event oluşturmuyor" requirement). `filledAt` is set only
 * on the transition INTO `FILLED`, never overwritten on a subsequent
 * idempotent re-application. Tenant-scoped; never gated by the kill switch
 * for the same reason cancellation/reconciliation aren't -- recording what
 * has ALREADY happened at the provider is not new exposure.
 */
export async function applyFillUpdate(params: {
  organizationId: string;
  clientOrderId: string;
  filledQuantity: number;
  averageFillPrice: number | null;
  status: ExecutionOrderStatus;
}): Promise<{ changed: boolean }> {
  const { organizationId, clientOrderId, filledQuantity, averageFillPrice, status } = params;
  const scoped = getTenantScopedClient(organizationId);

  const existing = await scoped.liveOrder.findUnique({ where: { organizationId_clientOrderId: { organizationId, clientOrderId } } });
  if (!existing) throw new LiveOrderNotFoundError(clientOrderId);

  const noChange =
    Number(existing.filledQuantity) === filledQuantity &&
    (existing.averageFillPrice === null ? null : Number(existing.averageFillPrice)) === averageFillPrice &&
    existing.status === status;
  if (noChange) return { changed: false };

  await scoped.liveOrder.update({
    where: { organizationId_clientOrderId: { organizationId, clientOrderId } },
    data: {
      filledQuantity,
      averageFillPrice,
      status,
      filledAt: status === "FILLED" && existing.filledAt === null ? new Date() : existing.filledAt,
    },
  });
  await recordExecutionAudit({
    organizationId,
    action: "execution.fill_recorded",
    clientOrderId,
    symbol: existing.symbol,
    executionResult: status,
    metadata: { filledQuantity, averageFillPrice },
  });
  return { changed: true };
}

/**
 * Looks up this order's CURRENT state directly from the provider
 * (`gateway.getOrder`) and applies it via `applyFillUpdate` -- the
 * explicit, caller-invoked correction step for a `partial_fill`/
 * `unexpected_close` mismatch `reconcile()` detected. If the provider
 * genuinely has no record (`null`), local state is left untouched rather
 * than guessed at -- matches `reconciliation.ts`'s own "never self-heal by
 * guessing" discipline.
 */
export async function syncOrderFillFromProvider(params: { organizationId: string; gateway: ExecutionGateway; clientOrderId: string }): Promise<{ changed: boolean }> {
  const { organizationId, gateway, clientOrderId } = params;
  const scoped = getTenantScopedClient(organizationId);
  const existing = await scoped.liveOrder.findUnique({ where: { organizationId_clientOrderId: { organizationId, clientOrderId } } });
  if (!existing) throw new LiveOrderNotFoundError(clientOrderId);

  const remote = await gateway.getOrder(clientOrderId, existing.symbol);
  if (!remote) return { changed: false };

  return applyFillUpdate({ organizationId, clientOrderId, filledQuantity: remote.filledQuantity, averageFillPrice: remote.averageFillPrice, status: remote.status });
}

/**
 * The single, explicit answer to "may we do X while the kill switch is
 * engaged" for the two existing-risk actions this module supports --
 * documented here rather than left implicit, so a future caller never has
 * to re-derive the policy: cancelling and reconciling are ALWAYS allowed
 * (they can only reduce risk or reveal drift, never create exposure);
 * submitting a NEW order is never allowed while engaged (enforced
 * separately, in `validation.ts`, which this function does not duplicate).
 */
export const KILL_SWITCH_POSITION_POLICY = {
  cancelExistingOrder: "always_allowed",
  reconcileExistingState: "always_allowed",
  submitNewOrder: "blocked_by_validation_ts",
  autoCloseOnEngage: "never_implemented_by_design",
} as const;

export { isSafeToOpenNewOrders };
