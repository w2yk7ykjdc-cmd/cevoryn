import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export type AuditActorType = "USER" | "SYSTEM" | "CRON" | "AI_WORKER";

interface RecordAuditEventParams {
  organizationId: string;
  actorType: AuditActorType;
  /** userId for USER, worker/job identifier for AI_WORKER/CRON, omit for SYSTEM. */
  actorId?: string;
  /** Dot-namespaced action name, e.g. "entity.created", "opportunity.status_changed". */
  action: string;
  resourceType: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Enterprise audit trail: general-purpose "who did what," distinct from
 * DecisionTimelineEvent (Decision-only lifecycle). Best-effort by design -
 * a logging failure must never fail the operation being audited, so this
 * never throws; a write failure is reported to Sentry via the caller's own
 * error handling if it matters, not surfaced as a user-facing error.
 *
 * NEVER pass secrets/tokens/credentials in `metadata` - this table has no
 * special redaction, so treat it like any other application log.
 */
export async function recordAuditEvent(
  params: RecordAuditEventParams
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        organizationId: params.organizationId,
        actorType: params.actorType,
        actorId: params.actorId ?? null,
        action: params.action,
        resourceType: params.resourceType,
        resourceId: params.resourceId ?? null,
        metadata: (params.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    console.error(
      "[cevoryn:audit] failed to record audit event",
      params.action,
      error instanceof Error ? error.message : "unknown error"
    );
  }
}

const MAX_AUDIT_LOG_PAGE_SIZE = 200;

export async function listAuditLogs(
  organizationId: string,
  options: {
    resourceType?: string;
    resourceId?: string;
    take?: number;
  } = {}
) {
  const take = Math.min(options.take ?? 50, MAX_AUDIT_LOG_PAGE_SIZE);
  return prisma.auditLog.findMany({
    where: {
      organizationId,
      ...(options.resourceType && { resourceType: options.resourceType }),
      ...(options.resourceId && { resourceId: options.resourceId }),
    },
    orderBy: { createdAt: "desc" },
    take,
  });
}
