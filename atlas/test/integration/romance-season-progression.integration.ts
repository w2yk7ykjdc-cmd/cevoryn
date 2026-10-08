/**
 * Real Postgres integration coverage for cross-season progression
 * (src/features/romance/sessions/romance-session.service.ts's
 * resolveSeasonForPlayer/carryForwardSeasonState) - the piece that makes
 * a second season actually reachable and continuous with the first,
 * rather than cosmetic content nobody can get to. Without this, every
 * returning player would be handed a fresh Season One StorySession
 * forever, and even if they somehow reached Season Two, every
 * relationship/memory/bargain/promise/debt would silently reset to
 * nothing (all five tables are scoped by storySessionId, not by
 * playerId+universeId).
 *
 * NEVER RUN THIS AGAINST PRODUCTION. Requires INTEGRATION_DATABASE_URL,
 * refuses a Supabase-shaped host, run via `npm run test:integration`.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import type { ensureRomancePlayer as EnsureRomancePlayerType } from "../../src/features/romance/player/romance-player.service";
import type {
  resolveSeasonForPlayer as ResolveSeasonForPlayerType,
  startOrResumeStorySession as StartOrResumeStorySessionType,
} from "../../src/features/romance/sessions/romance-session.service";
import type { prisma as PrismaType } from "../../src/lib/prisma";

const INTEGRATION_DATABASE_URL = process.env.INTEGRATION_DATABASE_URL;

if (!INTEGRATION_DATABASE_URL) {
  console.error(
    "\nINTEGRATION_DATABASE_URL is not set.\n" +
      "This suite requires a real, disposable local Postgres database - it must\n" +
      "never point at production. Example:\n\n" +
      "  INTEGRATION_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/cevoryn_integration_test \\\n" +
      "    npm run test:integration\n"
  );
  process.exit(1);
}

if (/supabase\.co/i.test(INTEGRATION_DATABASE_URL)) {
  console.error(
    "INTEGRATION_DATABASE_URL looks like a Supabase (production-shaped) host - refusing to run."
  );
  process.exit(1);
}

const RUN_ID = randomUUID().slice(0, 8);

let prisma: typeof PrismaType;
let ensureRomancePlayer: typeof EnsureRomancePlayerType;
let resolveSeasonForPlayer: typeof ResolveSeasonForPlayerType;
let startOrResumeStorySession: typeof StartOrResumeStorySessionType;

let universeId: string;
let seasonOneId: string;
let seasonTwoId: string;

async function createVerifiedPlayer() {
  const player = await ensureRomancePlayer(`user-${RUN_ID}-${randomUUID()}`, "player@example.com");
  return prisma.romancePlayer.update({ where: { id: player.id }, data: { ageVerifiedAt: new Date() } });
}

before(async () => {
  process.env.DATABASE_URL = INTEGRATION_DATABASE_URL;
  process.env.DIRECT_URL = process.env.INTEGRATION_DIRECT_URL ?? INTEGRATION_DATABASE_URL;

  execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });

  const prismaModule = await import("../../src/lib/prisma");
  prisma = prismaModule.prisma;

  const playerModule = await import("../../src/features/romance/player/romance-player.service");
  ensureRomancePlayer = playerModule.ensureRomancePlayer;

  const sessionModule = await import("../../src/features/romance/sessions/romance-session.service");
  resolveSeasonForPlayer = sessionModule.resolveSeasonForPlayer;
  startOrResumeStorySession = sessionModule.startOrResumeStorySession;

  const universe = await prisma.universe.create({
    data: {
      slug: `progression-universe-${RUN_ID}`,
      name: "Progression Test Universe",
      description: "fixture",
      status: "PUBLISHED",
    },
  });
  universeId = universe.id;

  const seasonOne = await prisma.season.create({
    data: {
      universeId,
      slug: `progression-season-one-${RUN_ID}`,
      name: "Season One",
      seasonNumber: 1,
      synopsis: "fixture",
      status: "PUBLISHED",
    },
  });
  seasonOneId = seasonOne.id;
  await prisma.beat.create({
    data: {
      seasonId: seasonOneId,
      slug: "s1-beat-a",
      beatOrder: 1,
      name: "Season One, Beat A",
      availableActions: ["ASK_QUESTION", "GENERIC_ACTION"],
      characterInvolvement: ["caelan"],
    },
  });

  const seasonTwo = await prisma.season.create({
    data: {
      universeId,
      slug: `progression-season-two-${RUN_ID}`,
      name: "Season Two",
      seasonNumber: 2,
      synopsis: "fixture",
      status: "PUBLISHED",
    },
  });
  seasonTwoId = seasonTwo.id;
  await prisma.beat.create({
    data: {
      seasonId: seasonTwoId,
      slug: "s2-beat-a",
      beatOrder: 1,
      name: "Season Two, Beat A",
      availableActions: ["ASK_QUESTION", "GENERIC_ACTION"],
      characterInvolvement: ["caelan"],
    },
  });
});

after(async () => {
  await prisma.romancePlayer.deleteMany({ where: { userId: { startsWith: `user-${RUN_ID}-` } } });
  await prisma.beat.deleteMany({ where: { seasonId: { in: [seasonOneId, seasonTwoId] } } });
  await prisma.season.deleteMany({ where: { universeId } });
  await prisma.universe.deleteMany({ where: { id: universeId } });
  await prisma.$disconnect();
});

test("resolveSeasonForPlayer gives a brand-new player Season One", async () => {
  const player = await createVerifiedPlayer();
  const season = await resolveSeasonForPlayer(player.id, universeId);
  assert.equal(season?.id, seasonOneId);
});

test("resolveSeasonForPlayer advances to Season Two once Season One is COMPLETED, and stays there while Season Two is still in progress", async () => {
  const player = await createVerifiedPlayer();
  const character = await prisma.playerCharacter.create({
    data: { playerId: player.id, universeId, name: "Hero", pronouns: "she/her" },
  });

  const seasonOneSession = await prisma.storySession.create({
    data: {
      playerId: player.id,
      universeId,
      seasonId: seasonOneId,
      playerCharacterId: character.id,
      pinnedUniverseVersion: 1,
      pinnedSeasonVersion: 1,
      status: "COMPLETED",
      completedAt: new Date(),
    },
  });
  void seasonOneSession;

  const season = await resolveSeasonForPlayer(player.id, universeId);
  assert.equal(season?.id, seasonTwoId, "a player who completed Season One should be offered Season Two next");
});

test("resolveSeasonForPlayer falls back to the last season once every season is completed", async () => {
  const player = await createVerifiedPlayer();
  const character = await prisma.playerCharacter.create({
    data: { playerId: player.id, universeId, name: "Hero", pronouns: "she/her" },
  });

  for (const seasonId of [seasonOneId, seasonTwoId]) {
    await prisma.storySession.create({
      data: {
        playerId: player.id,
        universeId,
        seasonId,
        playerCharacterId: character.id,
        pinnedUniverseVersion: 1,
        pinnedSeasonVersion: 1,
        status: "COMPLETED",
        completedAt: new Date(),
      },
    });
  }

  const season = await resolveSeasonForPlayer(player.id, universeId);
  assert.equal(season?.id, seasonTwoId, "with nothing left to advance to, the last season is returned rather than null");
});

test("startOrResumeStorySession creates a brand-new Season Two StorySession once Season One is complete, carrying forward relationship/memory/bargain/promise/debt state", async () => {
  const player = await createVerifiedPlayer();
  const character = await prisma.playerCharacter.create({
    data: { playerId: player.id, universeId, name: "Hero", pronouns: "she/her" },
  });

  const seasonOneSession = await prisma.storySession.create({
    data: {
      playerId: player.id,
      universeId,
      seasonId: seasonOneId,
      playerCharacterId: character.id,
      pinnedUniverseVersion: 1,
      pinnedSeasonVersion: 1,
      status: "COMPLETED",
      completedAt: new Date(),
    },
  });

  // Standing state that should carry forward.
  await prisma.relationshipState.create({
    data: {
      storySessionId: seasonOneSession.id,
      playerId: player.id,
      characterSlug: "caelan",
      trust: 42,
      attraction: 17,
      fear: 5,
      loyalty: 30,
      tension: 8,
      trueNameCompelUsed: false,
    },
  });
  await prisma.romanceMemory.create({
    data: {
      storySessionId: seasonOneSession.id,
      playerId: player.id,
      type: "PROMISE",
      subject: "player",
      object: "caelan",
      content: "promised to return before moonrise",
      source: "USER_STATED",
      status: "ACTIVE",
      relatedCharacterSlug: "caelan",
    },
  });
  await prisma.canonFact.create({
    data: {
      storySessionId: seasonOneSession.id,
      playerId: player.id,
      factType: "CHARACTER_KNOWLEDGE",
      subject: "caelan",
      content: "player revealed true name: Elira",
    },
  });
  const sealedBargain = await prisma.bargain.create({
    data: {
      storySessionId: seasonOneSession.id,
      playerId: player.id,
      characterSlug: "caelan",
      terms: "my service for his protection",
      breachConsequence: "the Wild Hunt claims her favor instead",
      proposerConfirmed: true,
      counterpartyConfirmed: true,
      status: "SEALED",
      sealedAt: new Date(),
    },
  });
  const madePromise = await prisma.promise.create({
    data: {
      storySessionId: seasonOneSession.id,
      playerId: player.id,
      characterSlug: "caelan",
      madeBy: "player",
      content: "I will return before moonrise",
      status: "MADE",
    },
  });
  const openDebt = await prisma.debt.create({
    data: {
      storySessionId: seasonOneSession.id,
      playerId: player.id,
      owedByCharacterSlug: "caelan",
      owedToCharacterSlug: "rival",
      reason: "the Hunt's old debt",
      status: "OPEN",
    },
  });

  // Closed/resolved state that should NOT carry forward.
  await prisma.bargain.create({
    data: {
      storySessionId: seasonOneSession.id,
      playerId: player.id,
      characterSlug: "caelan",
      terms: "a bargain already broken",
      breachConsequence: "already paid",
      proposerConfirmed: true,
      counterpartyConfirmed: true,
      status: "BROKEN",
      resolvedAt: new Date(),
    },
  });
  await prisma.promise.create({
    data: {
      storySessionId: seasonOneSession.id,
      playerId: player.id,
      characterSlug: "caelan",
      madeBy: "player",
      content: "a promise already fulfilled",
      status: "FULFILLED",
      resolvedAt: new Date(),
    },
  });
  await prisma.romanceMemory.create({
    data: {
      storySessionId: seasonOneSession.id,
      playerId: player.id,
      type: "WORLD_EVENT",
      subject: "the_door",
      object: null,
      content: "a superseded memory",
      source: "SYSTEM_INFERRED",
      status: "SUPERSEDED",
    },
  });

  const seasonTwoSession = await startOrResumeStorySession(player.id, `progression-universe-${RUN_ID}`, character.id);
  assert.equal(seasonTwoSession.seasonId, seasonTwoId);
  assert.notEqual(seasonTwoSession.id, seasonOneSession.id);

  const [relationshipStates, memories, canonFacts, bargains, promises, debts] = await Promise.all([
    prisma.relationshipState.findMany({ where: { storySessionId: seasonTwoSession.id } }),
    prisma.romanceMemory.findMany({ where: { storySessionId: seasonTwoSession.id } }),
    prisma.canonFact.findMany({ where: { storySessionId: seasonTwoSession.id } }),
    prisma.bargain.findMany({ where: { storySessionId: seasonTwoSession.id } }),
    prisma.promise.findMany({ where: { storySessionId: seasonTwoSession.id } }),
    prisma.debt.findMany({ where: { storySessionId: seasonTwoSession.id } }),
  ]);

  assert.equal(relationshipStates.length, 1);
  assert.equal(relationshipStates[0]!.trust, 42);
  assert.equal(relationshipStates[0]!.attraction, 17);

  assert.equal(memories.length, 1, "only the ACTIVE memory should carry forward, not the SUPERSEDED one");
  assert.match(memories[0]!.content, /moonrise/);

  assert.equal(canonFacts.length, 1);
  assert.match(canonFacts[0]!.content, /Elira/);

  assert.equal(bargains.length, 1, "only the SEALED bargain should carry forward, not the BROKEN one");
  assert.notEqual(bargains[0]!.id, sealedBargain.id, "carried-forward bargain must be a new row, not the original");
  assert.equal(bargains[0]!.terms, sealedBargain.terms);
  assert.equal(bargains[0]!.status, "SEALED");

  assert.equal(promises.length, 1, "only the MADE promise should carry forward, not the FULFILLED one");
  assert.equal(promises[0]!.content, madePromise.content);

  assert.equal(debts.length, 1);
  assert.equal(debts[0]!.reason, openDebt.reason);

  // Calling it again while Season Two's session is still ACTIVE must
  // resume the same session, never carry state forward a second time.
  const resumed = await startOrResumeStorySession(player.id, `progression-universe-${RUN_ID}`, character.id);
  assert.equal(resumed.id, seasonTwoSession.id);
  const relationshipStatesAfterResume = await prisma.relationshipState.findMany({
    where: { storySessionId: seasonTwoSession.id },
  });
  assert.equal(relationshipStatesAfterResume.length, 1, "resuming must not duplicate carried-forward rows");
});

test("carryForwardSeasonState only ever reads the requesting player's own completed session (tenant isolation)", async () => {
  const playerA = await createVerifiedPlayer();
  const playerB = await createVerifiedPlayer();
  const characterA = await prisma.playerCharacter.create({
    data: { playerId: playerA.id, universeId, name: "Hero A", pronouns: "she/her" },
  });
  const characterB = await prisma.playerCharacter.create({
    data: { playerId: playerB.id, universeId, name: "Hero B", pronouns: "she/her" },
  });

  const playerASeasonOne = await prisma.storySession.create({
    data: {
      playerId: playerA.id,
      universeId,
      seasonId: seasonOneId,
      playerCharacterId: characterA.id,
      pinnedUniverseVersion: 1,
      pinnedSeasonVersion: 1,
      status: "COMPLETED",
      completedAt: new Date(),
    },
  });
  await prisma.relationshipState.create({
    data: {
      storySessionId: playerASeasonOne.id,
      playerId: playerA.id,
      characterSlug: "caelan",
      trust: 99,
    },
  });

  // Player B completed Season One too, but with no standing state at all.
  await prisma.storySession.create({
    data: {
      playerId: playerB.id,
      universeId,
      seasonId: seasonOneId,
      playerCharacterId: characterB.id,
      pinnedUniverseVersion: 1,
      pinnedSeasonVersion: 1,
      status: "COMPLETED",
      completedAt: new Date(),
    },
  });

  const playerBSeasonTwo = await startOrResumeStorySession(
    playerB.id,
    `progression-universe-${RUN_ID}`,
    characterB.id
  );
  const relationshipStates = await prisma.relationshipState.findMany({
    where: { storySessionId: playerBSeasonTwo.id },
  });
  assert.equal(
    relationshipStates.length,
    0,
    "player B's new Season Two session must never see player A's trust=99 relationship row"
  );
});
