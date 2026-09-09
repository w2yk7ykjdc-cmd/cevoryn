import { getTenantScopedClient } from "@/server/db/tenant";
import { recordExecutionAudit } from "@/server/execution/audit";
import { reconcile, isSafeToOpenNewOrders, type LocalOrderSnapshot, type ReconciliationResult } from "@/server/execution/reconciliation";
import type { ExecutionGateway } from "@/server/execution/types";

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
 * Known limitation, honestly documented rather than silently glossed over:
 * `LiveOrder` does not yet persist a running `filledQuantity` (no live
 * order has ever actually been filled -- `LIVE_EXECUTION_ENABLED` stays
 * `false` this sprint too), so every local snapshot reports `filledQuantity:
 * 0`. This means a `partial_fill` mismatch will correctly fire whenever the
 * PROVIDER reports any fill at all, which is the right, safe direction to
 * err in (never silently missing a real fill), but it cannot yet
 * distinguish "no fill happened" from "a fill happened and we haven't
 * caught up" -- a future sprint should add a persisted `filledQuantity`
 * column once real fills exist to reconcile against.
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
    filledQuantity: 0,
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
