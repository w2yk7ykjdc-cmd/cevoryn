import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { publishEvent } from "@/server/events/event-bus";
import { logger } from "@/server/logger/logger";

export type ActorType = "user" | "system" | "api_key" | "ai";

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
 * changes organization state, membership, roles, billing, API keys, or CRM
 * domain data (companies/contacts/leads/tasks), including AI-initiated ones.
 *
 * Pass `tx` when the audit row must be part of a larger Prisma transaction
 * (e.g. writing a Lead and its audit entry atomically). In that case the
 * event-bus publish is intentionally skipped here — publishing before the
 * surrounding transaction commits could notify subscribers about a write
 * that later rolls back. The caller must call `publishAuditEvent(entry)`
 * itself once the transaction has committed.
 */
export async function recordAuditLog(
  input: RecordAuditLogInput,
  tx?: Prisma.TransactionClient,
) {
  const client = tx ?? prisma;

  const entry = await client.auditLog.create({
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

  if (!tx) {
    await publishAuditEvent(entry);
  }

  return entry;
}

/** Publishes the `audit_log.recorded` event. Call after a transaction that used `recordAuditLog(input, tx)` commits. */
export async function publishAuditEvent(entry: {
  id: string;
  organizationId: string;
  action: string;
}): Promise<void> {
  await publishEvent(
    "audit_log.recorded",
    { auditLogId: entry.id, organizationId: entry.organizationId, action: entry.action },
    { organizationId: entry.organizationId },
  );
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

const CSV_HEADER = ["id", "createdAt", "action", "targetType", "targetId", "actorType", "actorId", "metadata"];
const MAX_EXPORT_ROWS = 10_000;

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export type ExportAuditLogsInput = {
  organizationId: string;
  action?: string;
  targetType?: string;
  from?: Date;
  to?: Date;
};

/**
 * Renders every entry matching the filters as CSV, paging through
 * `listAuditLogs` under the hood so a large organization's history doesn't
 * need to be materialized as one giant Prisma query. Capped at
 * `MAX_EXPORT_ROWS` — an org with more history than that needs a real
 * reporting pipeline, not a browser download.
 */
export async function exportAuditLogsCsv(input: ExportAuditLogsInput): Promise<{ csv: string; rowCount: number }> {
  const rows = [CSV_HEADER.join(",")];
  let cursor: string | undefined;
  let rowCount = 0;

  while (rowCount < MAX_EXPORT_ROWS) {
    const { entries, nextCursor } = await listAuditLogs({
      organizationId: input.organizationId,
      action: input.action,
      targetType: input.targetType,
      from: input.from,
      to: input.to,
      cursor,
      limit: 200,
    });

    for (const entry of entries) {
      rows.push(
        [
          entry.id,
          entry.createdAt.toISOString(),
          csvField(entry.action),
          csvField(entry.targetType),
          entry.targetId,
          entry.actorType,
          entry.actorId ?? "",
          csvField(JSON.stringify(entry.metadata)),
        ].join(","),
      );
    }

    rowCount += entries.length;
    if (!nextCursor || entries.length === 0) break;
    cursor = nextCursor;
  }

  return { csv: rows.join("\n"), rowCount };
}
