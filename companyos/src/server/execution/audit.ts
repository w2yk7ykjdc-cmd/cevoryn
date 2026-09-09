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
export async function recordExecutionAudit(params: {
  organizationId: string;
  action:
    | "execution.intent_created"
    | "execution.validation_passed"
    | "execution.validation_rejected"
    | "execution.risk_check_passed"
    | "execution.risk_check_rejected"
    | "execution.order_submitted"
    | "execution.order_failed"
    | "execution.order_cancelled"
    | "execution.reconciliation_mismatch";
  clientOrderId: string;
  symbol: string;
  strategyType?: string | null;
  decisionSymbol?: string | null;
  validationResult?: string | null;
  riskResult?: string | null;
  executionResult?: string | null;
  providerOrderId?: string | null;
  rejectionReason?: string | null;
}): Promise<void> {
  const { organizationId, action, clientOrderId, ...rest } = params;
  await prisma.auditLog.create({
    data: {
      organizationId,
      actorId: null,
      actorType: "system",
      action,
      targetType: "LiveOrder",
      targetId: clientOrderId,
      metadata: redactForLogging(rest) as unknown as Prisma.InputJsonValue,
    },
  });
}
