import "server-only";

import type { Memory } from "@prisma/client";

import { toMemoryCategory } from "@/lib/enum-validators";
import { prisma } from "@/lib/prisma";
import {
  createKeywordSearchProvider,
  type SearchProvider,
} from "@/lib/search/search-provider";

import type { CreateMemoryInput, UpdateMemoryInput } from "./schemas";

/**
 * All queries scoped by organizationId — never trust client-supplied IDs.
 */

export async function createMemory(
  organizationId: string,
  input: CreateMemoryInput,
  source: "MANUAL" | "CONVERSATION" | "INSIGHT" = "MANUAL",
  sourceId?: string
) {
  return prisma.memory.create({
    data: {
      organizationId,
      category: input.category,
      content: input.content,
      source,
      sourceId: sourceId ?? null,
    },
  });
}

export async function updateMemory(
  organizationId: string,
  input: UpdateMemoryInput
) {
  return prisma.memory.updateMany({
    where: { id: input.id, organizationId },
    data: {
      ...(input.content !== undefined && { content: input.content }),
      ...(input.category !== undefined && { category: input.category }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
    },
  });
}

export async function deleteMemory(organizationId: string, id: string) {
  return prisma.memory.deleteMany({
    where: { id, organizationId },
  });
}

export async function listMemories(
  organizationId: string,
  options: {
    category?: string;
    activeOnly?: boolean;
    limit?: number;
  } = {}
) {
  const { category, activeOnly = true, limit = 50 } = options;

  return prisma.memory.findMany({
    where: {
      organizationId,
      ...(activeOnly && { isActive: true }),
      ...(category && { category: toMemoryCategory(category) ?? undefined }),
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });
}

/**
 * Search memories by content for contextual retrieval. Behind the
 * SearchProvider seam (src/lib/search/search-provider.ts) so a future
 * SemanticSearchProvider can be substituted here without this function's
 * callers changing - today it's still exactly the same PostgreSQL ILIKE
 * query this function always ran.
 */
const memorySearchProvider: SearchProvider<Memory> =
  createKeywordSearchProvider((organizationId, query, limit) =>
    prisma.memory.findMany({
      where: {
        organizationId,
        isActive: true,
        content: { contains: query, mode: "insensitive" },
      },
      orderBy: { confidence: "desc" },
      take: limit,
    })
  );

export async function searchMemories(
  organizationId: string,
  query: string,
  limit: number = 10
) {
  return memorySearchProvider.search(organizationId, query, limit);
}

/**
 * Get recent memories for AI context injection.
 * Returns the most relevant active memories.
 */
export async function getMemoriesForContext(
  organizationId: string,
  limit: number = 15
) {
  return prisma.memory.findMany({
    where: {
      organizationId,
      isActive: true,
    },
    orderBy: [{ confidence: "desc" }, { updatedAt: "desc" }],
    take: limit,
    select: {
      category: true,
      content: true,
    },
  });
}

export async function getMemoryCount(organizationId: string) {
  return prisma.memory.count({
    where: { organizationId, isActive: true },
  });
}
