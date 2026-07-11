import "server-only";

import { prisma } from "@/lib/prisma";

import type { PulseMetrics } from "../core/types";

/**
 * Compute pulse metrics for an organization over a time window.
 * All data comes from actual database records — no mocks.
 */
export async function computePulse(
  organizationId: string,
  periodStart: Date,
  periodEnd: Date
): Promise<PulseMetrics> {
  const [
    conversationCount,
    messageCount,
    activeUsers,
    tokenUsage,
    avgDuration,
  ] = await Promise.all([
    // Conversations in period
    prisma.conversation.count({
      where: {
        organizationId,
        createdAt: { gte: periodStart, lte: periodEnd },
      },
    }),

    // Messages in period
    prisma.message.count({
      where: {
        conversation: { organizationId },
        createdAt: { gte: periodStart, lte: periodEnd },
      },
    }),

    // Distinct active users
    prisma.conversation
      .findMany({
        where: {
          organizationId,
          createdAt: { gte: periodStart, lte: periodEnd },
        },
        select: { createdById: true },
        distinct: ["createdById"],
      })
      .then((rows: Array<{ createdById: string }>) => rows.length),

    // Token usage
    prisma.usageRecord
      .aggregate({
        where: {
          organizationId,
          createdAt: { gte: periodStart, lte: periodEnd },
        },
        _sum: {
          inputTokens: true,
          outputTokens: true,
          totalTokens: true,
        },
      })
      .then(
        (r: {
          _sum: {
            inputTokens: number | null;
            outputTokens: number | null;
            totalTokens: number | null;
          };
        }) => ({
          input: r._sum.inputTokens ?? 0,
          output: r._sum.outputTokens ?? 0,
          total: r._sum.totalTokens ?? 0,
        })
      ),

    // Average response time
    prisma.message
      .aggregate({
        where: {
          conversation: { organizationId },
          role: "ASSISTANT",
          durationMs: { not: null },
          createdAt: { gte: periodStart, lte: periodEnd },
        },
        _avg: { durationMs: true },
      })
      .then(
        (r: { _avg: { durationMs: number | null } }) =>
          Math.round(r._avg.durationMs ?? 0)
      ),
  ]);

  return {
    conversationCount,
    messageCount,
    activeUserCount: activeUsers,
    topTopics: [], // Topic extraction requires NLP — extension point
    avgResponseTimeMs: avgDuration,
    tokenUsage,
  };
}

/**
 * Save or update a pulse snapshot.
 */
export async function savePulseSnapshot(
  organizationId: string,
  period: "DAILY" | "WEEKLY",
  metrics: PulseMetrics,
  periodStart: Date,
  periodEnd: Date
) {
  return prisma.pulseSnapshot.upsert({
    where: {
      organizationId_period_periodStart: {
        organizationId,
        period,
        periodStart,
      },
    },
    create: {
      organizationId,
      period,
      metrics: JSON.parse(JSON.stringify(metrics)),
      periodStart,
      periodEnd,
    },
    update: {
      metrics: JSON.parse(JSON.stringify(metrics)),
      periodEnd,
    },
  });
}

/**
 * Get the latest pulse snapshot.
 */
export async function getLatestPulse(
  organizationId: string,
  period: "DAILY" | "WEEKLY"
) {
  return prisma.pulseSnapshot.findFirst({
    where: { organizationId, period },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Get pulse history for trend analysis.
 */
export async function getPulseHistory(
  organizationId: string,
  period: "DAILY" | "WEEKLY",
  limit: number = 14
) {
  return prisma.pulseSnapshot.findMany({
    where: { organizationId, period },
    orderBy: { periodStart: "desc" },
    take: limit,
  });
}

/**
 * Compute and save today's pulse.
 */
export async function refreshDailyPulse(
  organizationId: string
): Promise<PulseMetrics> {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  const metrics = await computePulse(organizationId, startOfDay, now);
  await savePulseSnapshot(organizationId, "DAILY", metrics, startOfDay, now);

  return metrics;
}
