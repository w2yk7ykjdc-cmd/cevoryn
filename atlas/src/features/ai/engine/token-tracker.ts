import "server-only";

import { prisma } from "@/lib/prisma";
import type { TokenUsage } from "@/types";

/**
 * Record token usage for non-conversation AI operations such as Insights,
 * Briefs, and Decision Canvas generation.
 */
export async function recordStandaloneUsage(params: {
  organizationId: string;
  userId: string;
  model: string;
  usage: TokenUsage;
}): Promise<void> {
  await prisma.usageRecord.create({
    data: {
      organizationId: params.organizationId,
      userId: params.userId,
      conversationId: null,
      model: params.model,
      inputTokens: params.usage.inputTokens,
      outputTokens: params.usage.outputTokens,
      totalTokens: params.usage.totalTokens,
    },
  });
}

/**
 * Get total tokens used by an organization in a date range.
 */
export async function getOrgUsage(
  organizationId: string,
  since: Date
): Promise<number> {
  const result = await prisma.usageRecord.aggregate({
    where: {
      organizationId,
      createdAt: { gte: since },
    },
    _sum: { totalTokens: true },
  });

  return result._sum.totalTokens ?? 0;
}

/**
 * Get total tokens used by a single user within an organization in a date
 * range — the per-user half of the daily rate limit, alongside
 * getOrgUsage's org-wide half.
 */
export async function getUserUsage(
  organizationId: string,
  userId: string,
  since: Date
): Promise<number> {
  const result = await prisma.usageRecord.aggregate({
    where: {
      organizationId,
      userId,
      createdAt: { gte: since },
    },
    _sum: { totalTokens: true },
  });

  return result._sum.totalTokens ?? 0;
}

/**
 * Get per-user usage breakdown for an organization.
 */
export async function getOrgUsageByUser(
  organizationId: string,
  since: Date
): Promise<Array<{ userId: string; totalTokens: number }>> {
  const results = await prisma.usageRecord.groupBy({
    by: ["userId"],
    where: {
      organizationId,
      createdAt: { gte: since },
    },
    _sum: { totalTokens: true },
    orderBy: { _sum: { totalTokens: "desc" } },
  });

  return results.map(
    (r: { userId: string; _sum: { totalTokens: number | null } }) => ({
      userId: r.userId,
      totalTokens: r._sum.totalTokens ?? 0,
    })
  );
}
