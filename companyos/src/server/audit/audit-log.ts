import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { publishEvent } from "@/server/events/event-bus";
import { logger } from "@/server/logger/logger";

export type ActorType = "user" | "system" | "api_key";

export type RecordAuditLogInput = {
  organizationId: string;
  actorId: string | null;
  actorType: ActorType;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string | null;
  userAgent?: string | null;
};

/**
 * Writes an immutable audit trail entry and fans it out on the event bus.
 * Audit logs are never updated or deleted through the application — they
 * are the tenant's compliance record. Call this from every mutation that
 * changes organization state, membership, roles, billing, or API keys.
 */
export async function recordAuditLog(input: RecordAuditLogInput) {
  const entry = await prisma.auditLog.create({
    data: {
      organizationId: input.organizationId,
      actorId: input.actorId,
      actorType: input.actorType,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: input.metadata ?? {},
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
  });

  logger.info(
    {
      organizationId: input.organizationId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
    },
    "audit log recorded",
  );

  await publishEvent(
    "audit_log.recorded",
    { auditLogId: entry.id, organizationId: input.organizationId, action: input.action },
    { organizationId: input.organizationId },
  );

  return entry;
}

export type ListAuditLogsInput = {
  organizationId: string;
  cursor?: string;
  limit?: number;
  action?: string;
  targetType?: string;
  from?: Date;
  to?: Date;
};

/** Paginated, filterable read path for the org's audit log viewer. */
export async function listAuditLogs(input: ListAuditLogsInput) {
  const limit = Math.min(input.limit ?? 50, 200);

  const entries = await prisma.auditLog.findMany({
    where: {
      organizationId: input.organizationId,
      action: input.action,
      targetType: input.targetType,
      createdAt:
        input.from || input.to
          ? { gte: input.from, lte: input.to }
          : undefined,
    },
    // `id` (cuid, monotonically increasing) breaks ties within the same
    // millisecond so cursor pagination stays deterministic even when
    // several entries are recorded back-to-back.
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });

  const hasMore = entries.length > limit;
  const page = hasMore ? entries.slice(0, limit) : entries;

  return {
    entries: page,
    nextCursor: hasMore ? page[page.length - 1]?.id : null,
  };
}
