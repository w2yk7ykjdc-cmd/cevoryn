import "server-only";

import { prisma } from "@/lib/prisma";

export class RomanceStoryContentError extends Error {}

/**
 * Starts a new StorySession, or resumes the player's existing ACTIVE one
 * for this universe/season - never a silent second session per universe.
 * Pins the content version at creation time (pinnedUniverseVersion/
 * pinnedSeasonVersion) so a later content edit can never retroactively
 * change an in-progress session's rules (Story Engine Bible §24).
 */
export async function startOrResumeStorySession(
  playerId: string,
  universeSlug: string,
  playerCharacterId: string
) {
  const universe = await prisma.universe.findFirst({
    where: { slug: universeSlug, status: "PUBLISHED" },
    orderBy: { version: "desc" },
  });
  if (!universe) throw new RomanceStoryContentError("Universe not found.");

  const season = await prisma.season.findFirst({
    where: { universeId: universe.id, status: "PUBLISHED" },
    orderBy: { seasonNumber: "asc" },
  });
  if (!season) throw new RomanceStoryContentError("Season not found.");

  const existing = await prisma.storySession.findFirst({
    where: {
      playerId,
      universeId: universe.id,
      seasonId: season.id,
      status: "ACTIVE",
    },
    orderBy: { startedAt: "desc" },
  });
  if (existing) return existing;

  const firstBeat = await prisma.beat.findFirst({
    where: { seasonId: season.id },
    orderBy: { beatOrder: "asc" },
  });

  return prisma.storySession.create({
    data: {
      playerId,
      universeId: universe.id,
      seasonId: season.id,
      playerCharacterId,
      pinnedUniverseVersion: universe.version,
      pinnedSeasonVersion: season.version,
      currentBeatId: firstBeat?.id ?? null,
    },
  });
}

/**
 * Everything a resumed session screen needs to render without
 * regenerating history: current beat, relationship state per character,
 * recent memories, unresolved bargains/promises/debts, the player
 * character, and the most recent resolved scenes. Tenant-scoped (never a
 * bare id lookup) - returns null for a session that is not this player's.
 */
export async function loadStoryContext(playerId: string, storySessionId: string) {
  const session = await prisma.storySession.findFirst({
    where: { id: storySessionId, playerId },
    include: { currentBeat: true, playerCharacter: true, universe: true },
  });
  if (!session) return null;

  const [
    relationshipStates,
    recentMemories,
    openBargains,
    openPromises,
    openDebts,
    recentResolvedEvents,
  ] = await Promise.all([
    prisma.relationshipState.findMany({ where: { storySessionId } }),
    prisma.romanceMemory.findMany({
      where: { storySessionId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.bargain.findMany({
      where: { storySessionId, status: { in: ["PROPOSED", "SEALED"] } },
    }),
    prisma.promise.findMany({ where: { storySessionId, status: "MADE" } }),
    prisma.debt.findMany({
      where: { storySessionId, status: { in: ["OPEN", "ESCALATED"] } },
    }),
    prisma.storyEvent.findMany({
      where: { storySessionId, type: "INTENT_RESOLVED" },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  return {
    session,
    relationshipStates,
    recentMemories,
    openBargains,
    openPromises,
    openDebts,
    recentResolvedEvents,
  };
}
