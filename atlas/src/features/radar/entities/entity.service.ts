import "server-only";

import type { Prisma } from "@prisma/client";

import { recordAuditEvent } from "@/features/enterprise/audit/audit.service";
import { prisma } from "@/lib/prisma";

import { normalizeCompanyName } from "./entity-normalization";
import type {
  CreateExternalEntityInput,
  UpdateExternalEntityInput,
} from "./schemas";

export { normalizeCompanyName };

export async function listWatchedEntities(
  organizationId: string,
  options: { includeInactive?: boolean } = {}
) {
  return prisma.externalEntity.findMany({
    where: {
      organizationId,
      ...(options.includeInactive ? {} : { isActive: true }),
    },
    orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
  });
}

export async function getWatchedEntity(organizationId: string, id: string) {
  return prisma.externalEntity.findFirst({
    where: { id, organizationId },
  });
}

export class DuplicateEntityError extends Error {
  constructor(name: string) {
    super(`"${name}" is already on the watchlist.`);
    this.name = "DuplicateEntityError";
  }
}

export async function createWatchedEntity(
  organizationId: string,
  addedByUserId: string,
  input: CreateExternalEntityInput
) {
  const normalizedName = normalizeCompanyName(input.name);

  const existing = await prisma.externalEntity.findUnique({
    where: {
      organizationId_normalizedName: { organizationId, normalizedName },
    },
    select: { id: true },
  });
  if (existing) throw new DuplicateEntityError(input.name);

  const entity = await prisma.externalEntity.create({
    data: {
      organizationId,
      addedByUserId,
      name: input.name,
      normalizedName,
      domain: input.domain ?? null,
      industry: input.industry ?? null,
      country: input.country ?? null,
      watchReason: input.watchReason,
      priority: input.priority,
      tags: input.tags,
      notes: input.notes,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });

  await recordAuditEvent({
    organizationId,
    actorType: "USER",
    actorId: addedByUserId,
    action: "entity.created",
    resourceType: "external_entity",
    resourceId: entity.id,
    metadata: { name: entity.name, watchReason: entity.watchReason },
  });

  return entity;
}

export async function updateWatchedEntity(
  organizationId: string,
  id: string,
  input: UpdateExternalEntityInput,
  actorUserId: string
) {
  const result = await prisma.externalEntity.updateMany({
    where: { id, organizationId },
    data: {
      ...(input.domain !== undefined && { domain: input.domain }),
      ...(input.industry !== undefined && { industry: input.industry }),
      ...(input.country !== undefined && { country: input.country }),
      ...(input.watchReason !== undefined && {
        watchReason: input.watchReason,
      }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
      ...(input.isPaused !== undefined && { isPaused: input.isPaused }),
      ...(input.priority !== undefined && { priority: input.priority }),
      ...(input.tags !== undefined && { tags: input.tags }),
      ...(input.notes !== undefined && { notes: input.notes }),
      ...(input.metadata !== undefined && {
        metadata: input.metadata as Prisma.InputJsonValue,
      }),
    },
  });

  if (result.count > 0) {
    await recordAuditEvent({
      organizationId,
      actorType: "USER",
      actorId: actorUserId,
      action: "entity.updated",
      resourceType: "external_entity",
      resourceId: id,
      metadata: { fields: Object.keys(input) },
    });
  }

  return result;
}

/**
 * Soft-delete only: deactivating (rather than hard-deleting) an entity
 * keeps its historical ExternalSignal/ExternalEvent/Opportunity rows
 * queryable, which the Outcome Learning loop needs even after a company is
 * removed from active tracking.
 */
export async function deactivateWatchedEntity(
  organizationId: string,
  id: string,
  actorUserId: string
) {
  const result = await prisma.externalEntity.updateMany({
    where: { id, organizationId },
    data: { isActive: false },
  });

  if (result.count > 0) {
    await recordAuditEvent({
      organizationId,
      actorType: "USER",
      actorId: actorUserId,
      action: "entity.removed",
      resourceType: "external_entity",
      resourceId: id,
    });
  }

  return result;
}
