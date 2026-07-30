import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { getEmbeddingProvider } from "@/server/ai/providers/registry";
import type { MemoryKind, MemoryRecord } from "@/server/ai/memory/types";

/** Formats a float vector as a pgvector literal, e.g. `[0.1,-0.2,0.03]`. */
function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export type UpsertMemoryInput = {
  organizationId: string;
  userId?: string | null;
  conversationId?: string | null;
  kind: MemoryKind;
  content: string;
  metadata?: Record<string, unknown>;
};

/**
 * Embeds `content` and stores it as a long-term memory row. Prisma has no
 * query-builder support for pgvector columns, so the insert goes through
 * `$executeRaw` with the embedding bound as a parameterized `::vector` cast
 * — never string-interpolated — to avoid SQL injection.
 */
export async function upsertMemory(input: UpsertMemoryInput): Promise<string> {
  const provider = getEmbeddingProvider();
  const [embedding] = await provider.embed([input.content]);
  if (!embedding) {
    throw new Error("Embedding provider returned no vector");
  }

  const rows = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO "memory_record"
      ("id", "organizationId", "userId", "conversationId", "kind", "content", "embedding", "metadata", "createdAt")
    VALUES
      (
        gen_random_uuid()::text,
        ${input.organizationId},
        ${input.userId ?? null},
        ${input.conversationId ?? null},
        ${input.kind}::"MemoryKind",
        ${input.content},
        ${toVectorLiteral(embedding)}::vector,
        ${(input.metadata ?? {}) as Prisma.InputJsonValue}::jsonb,
        now()
      )
    RETURNING "id"
  `;

  const id = rows[0]?.id;
  if (!id) {
    throw new Error("Failed to insert memory record");
  }
  return id;
}

export type SearchMemoryInput = {
  organizationId: string;
  userId?: string | null;
  query: string;
  kind?: MemoryKind;
  limit?: number;
  /** Maximum cosine distance to include (0 = identical, 2 = opposite). */
  maxDistance?: number;
};

/** Cosine-similarity search over the org's (optionally user-scoped) long-term memory. */
export async function searchMemory(input: SearchMemoryInput): Promise<MemoryRecord[]> {
  const provider = getEmbeddingProvider();
  const [embedding] = await provider.embed([input.query]);
  if (!embedding) return [];

  const limit = Math.min(input.limit ?? 8, 50);
  const maxDistance = input.maxDistance ?? 0.5;
  const vectorLiteral = toVectorLiteral(embedding);

  const rows = await prisma.$queryRaw<
    {
      id: string;
      organizationId: string;
      userId: string | null;
      conversationId: string | null;
      kind: MemoryKind;
      content: string;
      metadata: Record<string, unknown>;
      createdAt: Date;
      distance: number;
    }[]
  >`
    SELECT
      "id", "organizationId", "userId", "conversationId", "kind", "content", "metadata", "createdAt",
      ("embedding" <=> ${vectorLiteral}::vector) AS distance
    FROM "memory_record"
    WHERE "organizationId" = ${input.organizationId}
      AND (${input.userId ?? null}::text IS NULL OR "userId" = ${input.userId ?? null})
      AND (${input.kind ?? null}::text IS NULL OR "kind" = ${input.kind ?? null}::"MemoryKind")
      AND ("embedding" <=> ${vectorLiteral}::vector) <= ${maxDistance}
    ORDER BY distance ASC
    LIMIT ${limit}
  `;

  return rows;
}
