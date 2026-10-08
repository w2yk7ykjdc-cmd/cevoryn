import "server-only";

import type { Prisma, RomanceAuditActorType } from "@prisma/client";

import { captureServerError } from "@/lib/error-reporting";
import { prisma } from "@/lib/prisma";

export type { RomanceAuditActorType };

interface RecordRomanceAuditEventParams {
  playerId: string;
  actorType: RomanceAuditActorType;
  action: string;
  resourceType: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Romance's own audit trail - deliberately a separate table from Cevoryn's
 * org-scoped `AuditLog` (ADR-0001's rejected-alternative section: this
 * keeps a deeply personal product surface out of any B2B admin's audit
 * view). Mirrors src/features/enterprise/audit/audit.service.ts's
 * recordAuditEvent() exactly: best-effort by design (a logging failure
 * must never fail the operation being audited), now reported to Sentry
 * via captureServerError on failure rather than only console.error.
 *
 * NEVER pass secrets/tokens/credentials in `metadata`.
 */
export async function recordRomanceAuditEvent(
  params: RecordRomanceAuditEventParams
): Promise<void> {
  try {
    await prisma.romanceAuditLog.create({
      data: {
        playerId: params.playerId,
        actorType: params.actorType,
        action: params.action,
        resourceType: params.resourceType,
        resourceId: params.resourceId ?? null,
        metadata: (params.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    captureServerError("romance-audit", error, {
      playerId: params.playerId,
      action: params.action,
    });
  }
}

const MAX_ROMANCE_AUDIT_LOG_PAGE_SIZE = 200;

export async function listRomanceAuditLogs(
  playerId: string,
  options: { resourceType?: string; take?: number } = {}
) {
  const take = Math.min(options.take ?? 50, MAX_ROMANCE_AUDIT_LOG_PAGE_SIZE);
  return prisma.romanceAuditLog.findMany({
    where: {
      playerId,
      ...(options.resourceType && { resourceType: options.resourceType }),
    },
    orderBy: { createdAt: "desc" },
    take,
  });
}
