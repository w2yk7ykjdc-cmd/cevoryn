import type { Prisma } from "@prisma/client";
import "server-only";

import { prisma } from "@/lib/prisma";

export class RomanceStoryContentError extends Error {}

/**
 * The season a player should play next in this universe: the
 * lowest-seasonNumber PUBLISHED season they have not yet COMPLETED. A
 * brand-new player always gets season 1 (no completed sessions exist
 * yet). If every published season is already completed, returns the
 * last one, so "continue" resumes/replays the finale rather than
 * erroring with no season left to offer.
 */
export async function resolveSeasonForPlayer(playerId: string, universeId: string) {
  const seasons = await prisma.season.findMany({
    where: { universeId, status: "PUBLISHED" },
    orderBy: { seasonNumber: "asc" },
  });
  if (seasons.length === 0) return null;

  for (const season of seasons) {
    const completed = await prisma.storySession.findFirst({
      where: { playerId, seasonId: season.id, status: "COMPLETED" },
      select: { id: true },
    });
    if (!completed) return season;
  }
  return seasons[seasons.length - 1]!;
}

/**
 * Carries real story state forward across a season boundary - the
 * mechanical form of "the world remembers you" when a new season's
 * StorySession begins, since RelationshipState/RomanceMemory/CanonFact/
 * Bargain/Promise/Debt are all scoped to one StorySession (one season's
 * playthrough), never shared across seasons by the schema itself. Only
 * called once, at the moment a brand-new season's StorySession is
 * created (never on resuming an existing one - see
 * startOrResumeStorySession). A no-op for a player's first season (no
 * prior completed session to carry anything from).
 *
 * What carries forward: every relationship dimension, every still-ACTIVE
 * memory, every CanonFact (sustained truths like a revealed true name),
 * every still-SEALED bargain and still-MADE promise and still-open debt.
 * What does not: resolved/broken bargains, fulfilled/broken promises,
 * resolved debts, and superseded memories - those are closed history,
 * not standing state a new season's scenes need to reason about.
 */
export async function carryForwardSeasonState(
  tx: Prisma.TransactionClient,
  params: { playerId: string; universeId: string; newStorySessionId: string }
): Promise<void> {
  const priorSession = await tx.storySession.findFirst({
    where: { playerId: params.playerId, universeId: params.universeId, status: "COMPLETED" },
    orderBy: { completedAt: "desc" },
  });
  if (!priorSession) return;

  const [relationshipStates, activeMemories, canonFacts, sealedBargains, openPromises, openDebts] =
    await Promise.all([
      tx.relationshipState.findMany({ where: { storySessionId: priorSession.id } }),
      tx.romanceMemory.findMany({ where: { storySessionId: priorSession.id, status: "ACTIVE" } }),
      tx.canonFact.findMany({ where: { storySessionId: priorSession.id } }),
      tx.bargain.findMany({ where: { storySessionId: priorSession.id, status: "SEALED" } }),
      tx.promise.findMany({ where: { storySessionId: priorSession.id, status: "MADE" } }),
      tx.debt.findMany({
        where: { storySessionId: priorSession.id, status: { in: ["OPEN", "ESCALATED"] } },
      }),
    ]);

  for (const state of relationshipStates) {
    await tx.relationshipState.create({
      data: {
        storySessionId: params.newStorySessionId,
        playerId: params.playerId,
        characterSlug: state.characterSlug,
        trust: state.trust,
        attraction: state.attraction,
        fear: state.fear,
        loyalty: state.loyalty,
        tension: state.tension,
        trueNameCompelUsed: state.trueNameCompelUsed,
      },
    });
  }

  for (const memory of activeMemories) {
    await tx.romanceMemory.create({
      data: {
        storySessionId: params.newStorySessionId,
        playerId: params.playerId,
        type: memory.type,
        subject: memory.subject,
        object: memory.object,
        content: memory.content,
        source: memory.source,
        confidence: memory.confidence,
        importance: memory.importance,
        status: "ACTIVE",
        validity: memory.validity,
        relatedCharacterSlug: memory.relatedCharacterSlug,
        relatedBeatSlug: memory.relatedBeatSlug,
      },
    });
  }

  for (const fact of canonFacts) {
    await tx.canonFact.create({
      data: {
        storySessionId: params.newStorySessionId,
        playerId: params.playerId,
        factType: fact.factType,
        subject: fact.subject,
        content: fact.content,
      },
    });
  }

  for (const bargain of sealedBargains) {
    await tx.bargain.create({
      data: {
        storySessionId: params.newStorySessionId,
        playerId: params.playerId,
        characterSlug: bargain.characterSlug,
        terms: bargain.terms,
        breachConsequence: bargain.breachConsequence,
        proposerConfirmed: bargain.proposerConfirmed,
        counterpartyConfirmed: bargain.counterpartyConfirmed,
        status: "SEALED",
        sealedAt: bargain.sealedAt,
      },
    });
  }

  for (const promise of openPromises) {
    await tx.promise.create({
      data: {
        storySessionId: params.newStorySessionId,
        playerId: params.playerId,
        characterSlug: promise.characterSlug,
        madeBy: promise.madeBy,
        content: promise.content,
        dueBeatSlug: promise.dueBeatSlug,
        status: "MADE",
      },
    });
  }

  for (const debt of openDebts) {
    await tx.debt.create({
      data: {
        storySessionId: params.newStorySessionId,
        playerId: params.playerId,
        owedByCharacterSlug: debt.owedByCharacterSlug,
        owedToCharacterSlug: debt.owedToCharacterSlug,
        reason: debt.reason,
        dueBeatSlug: debt.dueBeatSlug,
        status: debt.status,
      },
    });
  }
}

/**
 * Starts a new StorySession, or resumes the player's existing ACTIVE one
 * for this universe/season - never a silent second session per universe.
 * Pins the content version at creation time (pinnedUniverseVersion/
 * pinnedSeasonVersion) so a later content edit can never retroactively
 * change an in-progress session's rules (Story Engine Bible §24).
 * Which season is "current" is resolved per-player (resolveSeasonForPlayer)
 * rather than hard-coded to season 1, so completing a season actually
 * advances a returning player into the next one.
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

  const season = await resolveSeasonForPlayer(playerId, universe.id);
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

  return prisma.$transaction(async (tx) => {
    const session = await tx.storySession.create({
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
    await carryForwardSeasonState(tx, {
      playerId,
      universeId: universe.id,
      newStorySessionId: session.id,
    });
    return session;
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
