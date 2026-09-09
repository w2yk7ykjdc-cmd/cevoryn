import { getTenantScopedClient } from "@/server/db/tenant";

/**
 * Sprint 29: a pure, read-only summary of this organization's RECENT
 * reconciliation history -- built entirely from `AuditLog` rows
 * `position-management.ts#reconcileOrganizationLiveState` (Sprint 22/23)
 * already writes for every `execution.reconciliation_mismatch`/
 * `execution.position_reconciled` event. This module NEVER calls
 * `reconciliation.ts#reconcile()` itself (that requires a live
 * `ExecutionGateway`, i.e. real exchange credentials/network access) --
 * it only reads the immutable trail of PAST reconciliation runs the
 * autonomous-execution job already performed, so it is safe to expose
 * through a read-only AI tool with zero risk of ever reaching a real
 * exchange.
 */

const LOOKBACK_LIMIT = 200;

export type ReconciliationHealthSummary = {
  /** How many of the most recent (up to `LOOKBACK_LIMIT`) reconciliation-related audit rows were clean passes. */
  cleanPasses: number;
  /** Count of each mismatch type seen among the most recent rows, e.g. `{ quantity_mismatch: 2 }`. Empty if none. */
  mismatchCountsByType: Record<string, number>;
  /** Timestamp of the most recent reconciliation-related audit row of either kind, `null` if this organization has never had one (true for every organization today, since `LIVE_EXECUTION_ENABLED` stays `false`). */
  lastReconciledAt: Date | null;
};

export async function getReconciliationHealth(organizationId: string): Promise<ReconciliationHealthSummary> {
  const scoped = getTenantScopedClient(organizationId);
  const rows = await scoped.auditLog.findMany({
    where: { action: { in: ["execution.reconciliation_mismatch", "execution.position_reconciled"] } },
    orderBy: { createdAt: "desc" },
    take: LOOKBACK_LIMIT,
    select: { action: true, metadata: true, createdAt: true },
  });

  const mismatchCountsByType: Record<string, number> = {};
  let cleanPasses = 0;
  for (const row of rows) {
    if (row.action === "execution.position_reconciled") {
      cleanPasses += 1;
      continue;
    }
    // `recordExecutionAudit` spreads its params minus organizationId/action/
    // clientOrderId into `rest`, THEN wraps `rest` in `redactForLogging` as
    // the stored `metadata` column -- since the caller's own `metadata`
    // argument is itself one of `rest`'s keys, it lands one level deeper
    // than the top: `{ symbol, ..., metadata: { mismatchType } }`, not
    // `{ mismatchType }` directly. Read the actual persisted shape, not the
    // one it would be reasonable to guess.
    const outer = row.metadata as Record<string, unknown> | null;
    const inner = outer?.metadata as Record<string, unknown> | undefined;
    const mismatchType = typeof inner?.mismatchType === "string" ? inner.mismatchType : "unknown";
    mismatchCountsByType[mismatchType] = (mismatchCountsByType[mismatchType] ?? 0) + 1;
  }

  return { cleanPasses, mismatchCountsByType, lastReconciledAt: rows[0]?.createdAt ?? null };
}
