import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * Per-player action rate limiting - reuses the exact advisory-lock
 * TOCTOU-closing technique proven in
 * src/server/services/auth-rate-limit.service.ts::tryRecord(), applied
 * to Romance's own StoryEvent log instead of a new attempts table (no
 * need for one - StoryEvent already records every attempt). Prevents a
 * player from spamming free-form input to burn AI tokens or race the
 * Story Engine, per the brief's explicit "rate limiting on player input
 * where appropriate" requirement.
 */

const MAX_ACTIONS_PER_WINDOW = 10;
const WINDOW_MS = 10_000;

export async function isStoryActionRateLimited(playerId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`romance-action-rate-limit:${playerId}`}, 0))`;

    const since = new Date(Date.now() - WINDOW_MS);
    const count = await tx.storyEvent.count({
      where: {
        playerId,
        createdAt: { gte: since },
        type: { in: ["INTENT_RESOLVED", "INTENT_REJECTED"] },
      },
    });

    return count >= MAX_ACTIONS_PER_WINDOW;
  });
}
