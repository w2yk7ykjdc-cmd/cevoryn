import "server-only";

import type { Prisma } from "@prisma/client";

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
    orderBy: { createdAt: "desc" },
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

  return prisma.externalEntity.create({
    data: {
      organizationId,
      addedByUserId,
      name: input.name,
      normalizedName,
      domain: input.domain ?? null,
      industry: input.industry ?? null,
      country: input.country ?? null,
      watchReason: input.watchReason,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
}

export async function updateWatchedEntity(
  organizationId: string,
  id: string,
  input: UpdateExternalEntityInput
) {
  return prisma.externalEntity.updateMany({
    where: { id, organizationId },
    data: {
      ...(input.domain !== undefined && { domain: input.domain }),
      ...(input.industry !== undefined && { industry: input.industry }),
      ...(input.country !== undefined && { country: input.country }),
      ...(input.watchReason !== undefined && {
        watchReason: input.watchReason,
      }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
      ...(input.metadata !== undefined && {
        metadata: input.metadata as Prisma.InputJsonValue,
      }),
    },
  });
}

/**
 * Soft-delete only: deactivating (rather than hard-deleting) an entity
 * keeps its historical ExternalSignal/ExternalEvent/Opportunity rows
 * queryable, which the Outcome Learning loop needs even after a company is
 * removed from active tracking.
 */
export async function deactivateWatchedEntity(
  organizationId: string,
  id: string
) {
  return prisma.externalEntity.updateMany({
    where: { id, organizationId },
    data: { isActive: false },
  });
}
