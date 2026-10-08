/**
 * Real Postgres integration coverage for the first playable end-to-end
 * vertical slice: 18+ gate primitives, the real seeded content (via
 * prisma/seed-romance.ts, run for real against this test database),
 * character creation -> session start -> free-form input -> generated +
 * canon-validated scene -> memory/relationship persistence -> session
 * resume, LLM-canon-violation rejection through the full pipeline (not
 * just the pure scene-pipeline unit), idempotent replay, and rate
 * limiting.
 *
 * Scope note: this suite exercises the engine/service layer directly
 * (romance-story.service, romance-session.service, romance-player.service,
 * romance-rate-limit.service) - the same layer the Server Actions call
 * through. The Server Actions themselves (and true browser login) cannot
 * be exercised here because requireUser()/getUser() depend on a live
 * Next.js request context and a real Supabase project, neither of which
 * exists in this sandbox - see the final report. What IS proven here is
 * everything those actions actually delegate to once auth has passed.
 *
 * Same safety rules as every other suite in this directory: requires
 * INTEGRATION_DATABASE_URL explicitly, refuses anything supabase.co-shaped,
 * excluded from default `npm test`, run via `npm run test:integration`.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import type {
  ensureRomancePlayer as EnsureRomancePlayerType,
  isAdultVerified as IsAdultVerifiedType,
} from "../../src/features/romance/player/romance-player.service";
import type {
  getMemoriesForContext as GetMemoriesForContextType,
  submitPlayerInput as SubmitPlayerInputType,
} from "../../src/features/romance/engine/romance-story.service";
import type {
  loadStoryContext as LoadStoryContextType,
  startOrResumeStorySession as StartOrResumeStorySessionType,
} from "../../src/features/romance/sessions/romance-session.service";
import type { isStoryActionRateLimited as IsStoryActionRateLimitedType } from "../../src/features/romance/sessions/romance-rate-limit.service";
import { TestSceneProvider } from "../../src/features/romance/engine/scene-generation-provider";
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
let isAdultVerified: typeof IsAdultVerifiedType;
let submitPlayerInput: typeof SubmitPlayerInputType;
let getMemoriesForContext: typeof GetMemoriesForContextType;
let loadStoryContext: typeof LoadStoryContextType;
let startOrResumeStorySession: typeof StartOrResumeStorySessionType;
let isStoryActionRateLimited: typeof IsStoryActionRateLimitedType;

let fixtureUniverseId: string;
let fixtureSeasonId: string;
let fixtureBeatAId: string;
let fixtureBeatBId: string;

async function createVerifiedPlayer() {
  const player = await ensureRomancePlayer(
    `user-${RUN_ID}-${randomUUID()}`,
    "player@example.com"
  );
  return prisma.romancePlayer.update({
    where: { id: player.id },
    data: { ageVerifiedAt: new Date() },
  });
}

async function createPlayerCharacterFor(playerId: string, universeId: string) {
  return prisma.playerCharacter.create({
    data: { playerId, universeId, name: "Test Hero", pronouns: "she/her" },
  });
}

before(async () => {
  process.env.DATABASE_URL = INTEGRATION_DATABASE_URL;
  process.env.DIRECT_URL = process.env.INTEGRATION_DIRECT_URL ?? INTEGRATION_DATABASE_URL;

  execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });
  // Proves the real shipped seed script runs cleanly against a fresh
  // Postgres and produces content shaped exactly as beat-transition-math
  // expects (not just mocked fixture data).
  execSync("npx tsx prisma/seed-romance.ts", { stdio: "inherit", env: process.env });

  const prismaModule = await import("../../src/lib/prisma");
  prisma = prismaModule.prisma;

  const playerModule = await import("../../src/features/romance/player/romance-player.service");
  ensureRomancePlayer = playerModule.ensureRomancePlayer;
  isAdultVerified = playerModule.isAdultVerified;

  const storyModule = await import("../../src/features/romance/engine/romance-story.service");
  submitPlayerInput = storyModule.submitPlayerInput;
  getMemoriesForContext = storyModule.getMemoriesForContext;

  const sessionModule = await import("../../src/features/romance/sessions/romance-session.service");
  loadStoryContext = sessionModule.loadStoryContext;
  startOrResumeStorySession = sessionModule.startOrResumeStorySession;

  const rateLimitModule = await import(
    "../../src/features/romance/sessions/romance-rate-limit.service"
  );
  isStoryActionRateLimited = rateLimitModule.isStoryActionRateLimited;

  const universe = await prisma.universe.create({
    data: {
      slug: `loop-universe-${RUN_ID}`,
      name: "Loop Test Universe",
      description: "fixture",
      status: "PUBLISHED",
    },
  });
  fixtureUniverseId = universe.id;

  const season = await prisma.season.create({
    data: {
      universeId: universe.id,
      slug: `loop-season-${RUN_ID}`,
      name: "Loop Test Season",
      seasonNumber: 1,
      synopsis: "fixture",
      status: "PUBLISHED",
    },
  });
  fixtureSeasonId = season.id;

  const beatA = await prisma.beat.create({
    data: {
      seasonId: season.id,
      slug: "beat-a",
      beatOrder: 1,
      name: "Beat A",
      availableActions: ["ASK_QUESTION", "GENERIC_ACTION", "PROMISE"],
      exitConditions: [
        { onEventType: "INTENT_RESOLVED", next: "beat-b", minOccurrencesInBeat: 1 },
      ],
      characterInvolvement: ["caelan"],
    },
  });
  fixtureBeatAId = beatA.id;

  const beatB = await prisma.beat.create({
    data: {
      seasonId: season.id,
      slug: "beat-b",
      beatOrder: 2,
      name: "Beat B",
      availableActions: ["ASK_QUESTION", "GENERIC_ACTION", "PROMISE"],
      exitConditions: [
        { onEventType: "INTENT_RESOLVED", next: null, minOccurrencesInBeat: 1, completesSession: true },
      ],
      characterInvolvement: ["caelan"],
    },
  });
  fixtureBeatBId = beatB.id;
});

after(async () => {
  await prisma.romancePlayer.deleteMany({ where: { userId: { startsWith: `user-${RUN_ID}-` } } });
  await prisma.beat.deleteMany({ where: { seasonId: fixtureSeasonId } });
  await prisma.season.deleteMany({ where: { id: fixtureSeasonId } });
  await prisma.universe.deleteMany({ where: { id: fixtureUniverseId } });
  await prisma.$disconnect();
});

// --- 18+ age gate primitives -------------------------------------------

test("a freshly created player is not age-verified", async () => {
  const player = await ensureRomancePlayer(`user-${RUN_ID}-${randomUUID()}`, "a@example.com");
  assert.equal(isAdultVerified(player), false);
});

test("ensureRomancePlayer is idempotent - a second call for the same userId returns the same row, not a duplicate", async () => {
  const userId = `user-${RUN_ID}-${randomUUID()}`;
  const first = await ensureRomancePlayer(userId, "b@example.com");
  const second = await ensureRomancePlayer(userId, "b@example.com");
  assert.equal(first.id, second.id);

  const count = await prisma.romancePlayer.count({ where: { userId } });
  assert.equal(count, 1);
});

test("a verified player (ageVerifiedAt set to now) is adult-verified", async () => {
  const player = await createVerifiedPlayer();
  assert.equal(isAdultVerified(player), true);
});

test("a tampered future ageVerifiedAt is malformed/untrusted, not treated as verified", async () => {
  const player = await ensureRomancePlayer(`user-${RUN_ID}-${randomUUID()}`, "c@example.com");
  const tampered = await prisma.romancePlayer.update({
    where: { id: player.id },
    data: { ageVerifiedAt: new Date(Date.now() + 1000 * 60 * 60 * 24) }, // 1 day in the future
  });
  assert.equal(isAdultVerified(tampered), false);
});

// --- Full playable loop --------------------------------------------------

test("the full loop: create character -> start session -> free-form input -> validated scene -> memory/relationship persisted -> resume sees prior state", async () => {
  const player = await createVerifiedPlayer();
  const playerCharacter = await createPlayerCharacterFor(player.id, fixtureUniverseId);

  const session = await startOrResumeStorySession(player.id, `loop-universe-${RUN_ID}`, playerCharacter.id);
  assert.equal(session.currentBeatId, fixtureBeatAId);
  assert.equal(session.pinnedUniverseVersion, 1);

  const result = await submitPlayerInput({
    playerId: player.id,
    storySessionId: session.id,
    rawInput: "I ask Caelan why I was brought here.",
    targetCharacterSlug: "caelan",
    llmProvider: new TestSceneProvider((ctx) => ({
      narration: "Caelan studies you for a long moment before answering.",
      dialogueLines: [{ speakerSlug: "caelan", text: "Because the door chose you." }],
      sceneClaims: [],
      proposedRelationshipNudge: { characterSlug: "caelan", cause: "NARRATIVE_POSITIVE_BEAT" },
      proposedMemoryCandidates: [
        {
          type: "WORLD_EVENT",
          subject: "the_door",
          object: null,
          content: "The door chose the player, according to Caelan.",
        },
      ],
    })),
  });

  assert.equal(result.accepted, true);
  if (!result.accepted) throw new Error("unreachable");
  assert.equal(result.scene.narration, "Caelan studies you for a long moment before answering.");
  assert.equal(result.sceneFailureReason, null);
  // The ASK_QUESTION nudge + beat-advance (beat-a exits after 1 resolved intent) both fired.
  assert.equal(result.beatAdvancedTo, "beat-b");
  assert.equal(result.beatAdvancedToName, "Beat B");
  assert.ok(result.relationshipChanges && result.relationshipChanges.length > 0);

  const worldEventMemories = await getMemoriesForContext(player.id, session.id, {
    type: "WORLD_EVENT",
  });
  assert.equal(worldEventMemories.length, 1);
  assert.match(worldEventMemories[0]!.content, /door chose the player/);

  // "Leave and return" - a fresh loadStoryContext call must show the same state, not regenerate it.
  const resumed = await loadStoryContext(player.id, session.id);
  assert.ok(resumed);
  assert.equal(resumed!.session.currentBeat?.slug, "beat-b");
  assert.equal(resumed!.relationshipStates.length, 1);
  assert.equal(resumed!.relationshipStates[0]!.characterSlug, "caelan");
  assert.equal(resumed!.recentMemories.some((m) => m.content.includes("door chose the player")), true);
  assert.equal(resumed!.recentResolvedEvents.length, 1);
});

test("a second free-form action in beat-b completes the session (session resume reflects completion)", async () => {
  const player = await createVerifiedPlayer();
  const playerCharacter = await createPlayerCharacterFor(player.id, fixtureUniverseId);
  const session = await startOrResumeStorySession(player.id, `loop-universe-${RUN_ID}`, playerCharacter.id);

  await submitPlayerInput({
    playerId: player.id,
    storySessionId: session.id,
    rawInput: "I nod and follow him.",
    targetCharacterSlug: "caelan",
  });
  const second = await submitPlayerInput({
    playerId: player.id,
    storySessionId: session.id,
    rawInput: "I ask what happens next.",
    targetCharacterSlug: "caelan",
  });

  assert.equal(second.accepted, true);
  if (!second.accepted) throw new Error("unreachable");
  assert.equal(second.sessionCompleted, true);

  const resumed = await loadStoryContext(player.id, session.id);
  assert.equal(resumed!.session.status, "COMPLETED");
});

test("a scene that violates canon (unrevealed true name) never reaches the player - fallback is used and the failure is logged", async () => {
  const player = await createVerifiedPlayer();
  const playerCharacter = await createPlayerCharacterFor(player.id, fixtureUniverseId);
  const session = await startOrResumeStorySession(player.id, `loop-universe-${RUN_ID}`, playerCharacter.id);

  const violatingProvider = new TestSceneProvider(() => ({
    narration: "Caelan speaks your true name as though he has always known it.",
    dialogueLines: [{ speakerSlug: "caelan", text: "I know your true name." }],
    sceneClaims: [{ type: "CHARACTER_KNOWS_TRUE_NAME", characterSlug: "caelan" }],
    proposedRelationshipNudge: null,
    proposedMemoryCandidates: [],
  }));

  const result = await submitPlayerInput({
    playerId: player.id,
    storySessionId: session.id,
    rawInput: "I ask him a question.",
    targetCharacterSlug: "caelan",
    llmProvider: violatingProvider,
  });

  assert.equal(result.accepted, true);
  if (!result.accepted) throw new Error("unreachable");
  assert.equal(result.sceneFailureReason, "fallback");
  assert.deepEqual(result.scene.sceneClaims, []);
  assert.equal(/true name/i.test(result.scene.narration), false);

  const failureEvents = await prisma.storyEvent.findMany({
    where: { storySessionId: session.id, type: "CANON_VALIDATION_FAILED" },
  });
  assert.equal(failureEvents.length, 1);
  const payload = failureEvents[0]?.payload as { violations?: Array<{ ruleId: string }> };
  assert.equal(payload.violations?.[0]?.ruleId, "CANON-001");
});

test("a duplicate submission with the same idempotency key is not reprocessed", async () => {
  const player = await createVerifiedPlayer();
  const playerCharacter = await createPlayerCharacterFor(player.id, fixtureUniverseId);
  const session = await startOrResumeStorySession(player.id, `loop-universe-${RUN_ID}`, playerCharacter.id);

  const key = randomUUID();
  const first = await submitPlayerInput({
    playerId: player.id,
    storySessionId: session.id,
    rawInput: "I wait quietly.",
    targetCharacterSlug: "caelan",
    idempotencyKey: key,
  });
  const retry = await submitPlayerInput({
    playerId: player.id,
    storySessionId: session.id,
    rawInput: "I wait quietly.",
    targetCharacterSlug: "caelan",
    idempotencyKey: key,
  });

  assert.equal(first.accepted, true);
  assert.equal(retry.accepted, true);
  if (!first.accepted || !retry.accepted) throw new Error("unreachable");
  assert.equal(first.storyEventId, retry.storyEventId);

  const resolvedCount = await prisma.storyEvent.count({
    where: { storySessionId: session.id, type: "INTENT_RESOLVED" },
  });
  assert.equal(resolvedCount, 1);
});

test("rate limiting blocks a player after the window's action threshold is exceeded", async () => {
  const player = await createVerifiedPlayer();
  const playerCharacter = await createPlayerCharacterFor(player.id, fixtureUniverseId);
  const session = await startOrResumeStorySession(player.id, `loop-universe-${RUN_ID}`, playerCharacter.id);

  for (let i = 0; i < 10; i++) {
    await submitPlayerInput({
      playerId: player.id,
      storySessionId: session.id,
      rawInput: `action number ${i}`,
      targetCharacterSlug: "caelan",
    });
  }

  assert.equal(await isStoryActionRateLimited(player.id), true);
});

test("two different players starting the same universe each get their own isolated session", async () => {
  const playerA = await createVerifiedPlayer();
  const playerB = await createVerifiedPlayer();
  const characterA = await createPlayerCharacterFor(playerA.id, fixtureUniverseId);
  const characterB = await createPlayerCharacterFor(playerB.id, fixtureUniverseId);

  const sessionA = await startOrResumeStorySession(playerA.id, `loop-universe-${RUN_ID}`, characterA.id);
  const sessionB = await startOrResumeStorySession(playerB.id, `loop-universe-${RUN_ID}`, characterB.id);

  assert.notEqual(sessionA.id, sessionB.id);

  await submitPlayerInput({
    playerId: playerA.id,
    storySessionId: sessionA.id,
    rawInput: "I promise to help him.",
    targetCharacterSlug: "caelan",
  });

  const bContext = await loadStoryContext(playerB.id, sessionB.id);
  assert.equal(bContext!.recentResolvedEvents.length, 0);

  // Player B can never load Player A's session.
  const crossAccess = await loadStoryContext(playerB.id, sessionA.id);
  assert.equal(crossAccess, null);
});

test("calling startOrResumeStorySession twice for the same player/universe resumes rather than creating a second session", async () => {
  const player = await createVerifiedPlayer();
  const playerCharacter = await createPlayerCharacterFor(player.id, fixtureUniverseId);

  const first = await startOrResumeStorySession(player.id, `loop-universe-${RUN_ID}`, playerCharacter.id);
  const second = await startOrResumeStorySession(player.id, `loop-universe-${RUN_ID}`, playerCharacter.id);

  assert.equal(first.id, second.id);
  const count = await prisma.storySession.count({ where: { playerId: player.id, universeId: fixtureUniverseId } });
  assert.equal(count, 1);
});

// --- Real seed content sanity check --------------------------------------

test("the real shipped seed content (Thornbound) produces a beat graph shape compatible with the engine", async () => {
  const universe = await prisma.universe.findFirst({ where: { slug: "thornbound" } });
  assert.ok(universe, "seed-romance.ts should have created the Thornbound universe");

  const beats = await prisma.beat.findMany({
    where: { season: { universe: { slug: "thornbound" } } },
  });
  assert.equal(beats.length, 7);

  for (const beat of beats) {
    assert.ok(Array.isArray(beat.exitConditions), `${beat.slug}.exitConditions must be an array`);
  }

  const awakening = beats.find((b) => b.slug === "awakening");
  assert.ok(awakening);
  assert.ok(awakening!.availableActions.includes("ASK_QUESTION"));
});
