import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { getTenantScopedClient } from "@/server/db/tenant";
import type { RecordSignalOutcome, RecordSignalInput, ListSignalsInput } from "@/server/intelligence/signals/types";

function clampConfidence(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * The single, shared entry point for writing to the `CompanySignal` ledger —
 * used by both the real-time event subscriber (`sourceType: "domain_event"`)
 * and the recurring scanner (`sourceType: "scanner"`). Idempotent by
 * construction: upserts on the `[organizationId, sourceType, ruleName,
 * ruleVersion, sourceId]` unique constraint, so a redelivered domain event or
 * a re-run scan pass over an already-flagged entity updates the existing row
 * (refreshing `detectedAt`/`payload`/`severity`/`confidence`) instead of
 * creating a duplicate.
 *
 * Uses the raw `prisma` client (not `getTenantScopedClient`) because the
 * tenant-scoping Prisma extension does not intercept the `upsert` operation
 * (only `create`/`createMany` and the read/update/delete ops in its
 * `scopableOps` set — see `src/server/db/tenant.ts`) — scoping it here would
 * be a no-op that could look like protection without providing any. This
 * matches the existing precedent for upserts in this codebase (e.g.
 * `contacts/service.ts`'s `addTagToContact`, which upserts `Tag`/`ContactTag`
 * via the raw transaction client with `organizationId` included explicitly),
 * so `organizationId` is included explicitly in both the unique key and the
 * `create` payload below rather than being enforced by the extension.
 */
export async function recordSignal(
  input: RecordSignalInput,
): Promise<{ signal: Awaited<ReturnType<typeof prisma.companySignal.upsert>>; outcome: RecordSignalOutcome }> {
  const confidence = clampConfidence(input.confidence);

  const key = {
    organizationId_sourceType_ruleName_ruleVersion_sourceId: {
      organizationId: input.organizationId,
      sourceType: input.sourceType,
      ruleName: input.ruleName,
      ruleVersion: input.ruleVersion,
      sourceId: input.sourceId,
    },
  };

  const existing = await prisma.companySignal.findUnique({ where: key, select: { id: true } });

  const signal = await prisma.companySignal.upsert({
    where: key,
    create: {
      organizationId: input.organizationId,
      type: input.type,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      severity: input.severity,
      confidence,
      ruleName: input.ruleName,
      ruleVersion: input.ruleVersion,
      relatedEntityType: input.relatedEntityType ?? null,
      relatedEntityId: input.relatedEntityId ?? null,
      payload: (input.payload ?? {}) as Prisma.InputJsonValue,
      status: "active",
    },
    update: {
      type: input.type,
      severity: input.severity,
      confidence,
      relatedEntityType: input.relatedEntityType ?? null,
      relatedEntityId: input.relatedEntityId ?? null,
      payload: (input.payload ?? {}) as Prisma.InputJsonValue,
      detectedAt: new Date(),
      status: "active",
    },
  });

  return { signal, outcome: existing ? "updated" : "created" };
}

/** Paginated, filterable read path — mirrors `listAuditLogs`'s shape. */
export async function listSignals(input: ListSignalsInput) {
  const scoped = getTenantScopedClient(input.organizationId);
  const limit = Math.min(input.limit ?? 50, 200);

  const signals = await scoped.companySignal.findMany({
    where: {
      status: input.status,
      relatedEntityType: input.relatedEntityType,
      relatedEntityId: input.relatedEntityId,
      ruleName: input.ruleName,
    },
    orderBy: [{ detectedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });

  const hasMore = signals.length > limit;
  const page = hasMore ? signals.slice(0, limit) : signals;

  return { signals: page, nextCursor: hasMore ? page[page.length - 1]?.id : null };
}
