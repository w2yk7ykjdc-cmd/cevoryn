import "server-only";

import type { ProprietaryDataRecord } from "@prisma/client";

import { recordAuditEvent } from "@/features/enterprise/audit/audit.service";
import { prisma } from "@/lib/prisma";
import {
  createKeywordSearchProvider,
  type SearchProvider,
} from "@/lib/search/search-provider";

import type {
  CreateProprietaryDataRecordInput,
  UpdateProprietaryDataRecordInput,
} from "./schemas";

export async function listProprietaryDataRecords(
  organizationId: string,
  options: { take?: number } = {}
) {
  return prisma.proprietaryDataRecord.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: options.take ?? 100,
  });
}

export async function getProprietaryDataRecord(
  organizationId: string,
  id: string
) {
  return prisma.proprietaryDataRecord.findFirst({
    where: { id, organizationId },
  });
}

export async function createProprietaryDataRecord(
  organizationId: string,
  addedByUserId: string,
  input: CreateProprietaryDataRecordInput
) {
  const record = await prisma.proprietaryDataRecord.create({
    data: {
      organizationId,
      addedByUserId,
      sourceKind: input.sourceKind,
      title: input.title,
      content: input.content,
      url: input.url ?? null,
      tags: input.tags,
    },
  });

  await recordAuditEvent({
    organizationId,
    actorType: "USER",
    actorId: addedByUserId,
    action: "proprietary_data.created",
    resourceType: "proprietary_data_record",
    resourceId: record.id,
    metadata: { title: record.title, sourceKind: record.sourceKind },
  });

  return record;
}

export async function updateProprietaryDataRecord(
  organizationId: string,
  id: string,
  input: UpdateProprietaryDataRecordInput,
  actorUserId: string
) {
  const result = await prisma.proprietaryDataRecord.updateMany({
    where: { id, organizationId },
    data: {
      ...(input.sourceKind !== undefined && { sourceKind: input.sourceKind }),
      ...(input.title !== undefined && { title: input.title }),
      ...(input.content !== undefined && { content: input.content }),
      ...(input.url !== undefined && { url: input.url }),
      ...(input.tags !== undefined && { tags: input.tags }),
    },
  });

  if (result.count > 0) {
    await recordAuditEvent({
      organizationId,
      actorType: "USER",
      actorId: actorUserId,
      action: "proprietary_data.updated",
      resourceType: "proprietary_data_record",
      resourceId: id,
      metadata: { fields: Object.keys(input) },
    });
  }

  return result;
}

export async function deleteProprietaryDataRecord(
  organizationId: string,
  id: string,
  actorUserId: string
) {
  const result = await prisma.proprietaryDataRecord.deleteMany({
    where: { id, organizationId },
  });

  if (result.count > 0) {
    await recordAuditEvent({
      organizationId,
      actorType: "USER",
      actorId: actorUserId,
      action: "proprietary_data.deleted",
      resourceType: "proprietary_data_record",
      resourceId: id,
    });
  }

  return result;
}

/**
 * Search behind the SearchProvider seam (src/lib/search/search-provider.ts),
 * matching the exact convention searchMemories() already established - a
 * plain Postgres ILIKE query against title/content today, swappable for a
 * future SemanticSearchProvider without this function's callers changing.
 */
const proprietaryDataSearchProvider: SearchProvider<ProprietaryDataRecord> =
  createKeywordSearchProvider((organizationId, query, limit) =>
    prisma.proprietaryDataRecord.findMany({
      where: {
        organizationId,
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { content: { contains: query, mode: "insensitive" } },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
    })
  );

export async function searchProprietaryDataRecords(
  organizationId: string,
  query: string,
  limit: number = 20
) {
  return proprietaryDataSearchProvider.search(organizationId, query, limit);
}

/**
 * Recency-ordered slice for AI context injection (see
 * src/features/brain/proprietary-data/proprietary-data.module.ts) - matches
 * the same "top N, not query-matched" pattern getMemoriesForContext()
 * already uses for Memory, rather than trying to relevance-match the live
 * user message against ILIKE (which would rarely fire usefully).
 */
export async function getProprietaryDataForContext(
  organizationId: string,
  take: number = 8
) {
  return prisma.proprietaryDataRecord.findMany({
    where: { organizationId },
    orderBy: { updatedAt: "desc" },
    take,
    select: { sourceKind: true, title: true, content: true },
  });
}
