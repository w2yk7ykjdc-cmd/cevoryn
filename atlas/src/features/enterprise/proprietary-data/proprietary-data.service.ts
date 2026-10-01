import "server-only";

import type { ProprietaryDataRecord } from "@prisma/client";

import { hasFeature } from "@/features/billing/config/plans";
import { recordAuditEvent } from "@/features/enterprise/audit/audit.service";
import { prisma } from "@/lib/prisma";
import {
  createKeywordSearchProvider,
  type SearchProvider,
} from "@/lib/search/search-provider";
import { getOrganizationPlan } from "@/server/services/entitlement.service";

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
 * src/features/brain/proprietary-data/proprietary-data.module.ts and
 * src/features/radar/opportunities/opportunity-generator.ts) - matches the
 * same "top N, not query-matched" pattern getMemoriesForContext() already
 * uses for Memory, rather than trying to relevance-match the live message
 * against ILIKE (which would rarely fire usefully).
 *
 * Billing-gated: proprietary data must never be read for an organization
 * without the RADAR feature, even if it still has rows from before a
 * downgrade - returns an empty array (never throws) for a non-RADAR
 * organization, exactly as if it had no proprietary data at all. Every
 * caller of this function (chat context injection and Opportunity
 * generation alike) goes through this one check rather than repeating it
 * ad hoc, so consumption is gated consistently with the write-side gate on
 * the proprietary-data API routes.
 */
export async function getProprietaryDataForContext(
  organizationId: string,
  take: number = 8
) {
  const plan = await getOrganizationPlan(organizationId);
  if (!hasFeature(plan, "RADAR")) return [];

  return prisma.proprietaryDataRecord.findMany({
    where: { organizationId },
    orderBy: { updatedAt: "desc" },
    take,
    select: {
      id: true,
      sourceKind: true,
      title: true,
      content: true,
      url: true,
    },
  });
}

/**
 * Thin alias kept for the Opportunity/Threat generation call site (src/
 * features/radar/opportunities/opportunity-generator.ts) - the billing
 * check now lives in getProprietaryDataForContext() itself, so this no
 * longer duplicates it, but the distinct name is kept so that call site
 * continues to read as "the generation-specific entry point" rather than
 * a bare alias.
 */
export async function getProprietaryDataForOpportunityGeneration(
  organizationId: string,
  take: number = 5
) {
  return getProprietaryDataForContext(organizationId, take);
}
