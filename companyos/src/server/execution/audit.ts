import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { redactForLogging } from "@/server/execution/credentials";

/**
 * Sprint 22 Phase 14: an immutable audit trail for every intent that ever
 * reaches the live-execution path -- reuses the EXISTING `AuditLog` model
 * (Sprint 1) rather than a new, parallel audit table, the same "don't
 * duplicate an existing, adequate model" discipline every prior sprint has
 * applied to `CompanySignal`. `AuditLog` rows are already, structurally,
 * append-only (no update/delete path exists anywhere in this codebase for
 * them), which is exactly the "immutable" property this phase requires.
 *
 * `metadata` is passed through `redactForLogging` even though no field
 * this function accepts should ever legitimately contain a credential --
 * defense in depth, matching the same discipline
 * `binance-private-client.ts` already applies to its own log lines.
 */
export type ExecutionAuditAction =
  | "execution.intent_created"
  | "execution.validation_passed"
  | "execution.validation_rejected"
  | "execution.risk_check_passed"
  | "execution.risk_check_rejected"
  | "execution.order_submitted"
  | "execution.order_failed"
  | "execution.order_cancelled"
  | "execution.reconciliation_mismatch"
  // Sprint 23 Phase 2: credential lifecycle events -- `metadata` for these
  // NEVER carries a plaintext or encrypted secret value, only the
  // fingerprint/timestamps already safe to display (see
  // `org-credentials.ts`'s own doc comment).
  | "execution.credentials_configured"
  | "execution.credentials_rotated"
  | "execution.credentials_revoked"
  // Sprint 23 Phase 4: existing-position management under the kill switch.
  | "execution.order_cancel_requested"
  | "execution.position_reconciled";

export async function recordExecutionAudit(params: {
  organizationId: string;
  action: ExecutionAuditAction;
  /** Identifies the target row this event is about -- a `LiveOrder.clientOrderId` for order/reconciliation events, or the organization id itself for credential events (there is exactly one credential row per organization, so its own id is a stable, unambiguous target). */
  clientOrderId: string;
  symbol: string;
  strategyType?: string | null;
  decisionSymbol?: string | null;
  validationResult?: string | null;
  riskResult?: string | null;
  executionResult?: string | null;
  providerOrderId?: string | null;
  rejectionReason?: string | null;
  /** Extra, already-safe-to-log fields (e.g. a credential fingerprint) -- still passed through `redactForLogging` as defense in depth. */
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  const { organizationId, action, clientOrderId, ...rest } = params;
  const targetType = action.startsWith("execution.credentials_") ? "OrganizationExecutionCredential" : "LiveOrder";
  await prisma.auditLog.create({
    data: {
      organizationId,
      actorId: null,
      actorType: "system",
      action,
      targetType,
      targetId: clientOrderId,
      metadata: redactForLogging(rest) as unknown as Prisma.InputJsonValue,
    },
  });
}
