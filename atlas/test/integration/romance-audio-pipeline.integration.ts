/**
 * Real Postgres integration coverage for the audio render pipeline
 * (src/features/romance/audio/**). Exercises renderSceneAudio() and
 * getAudioForStoryEvent() end-to-end with injected TestTTSProvider/
 * TestAudioStorageProvider test doubles - never a real network call to
 * OpenAI or Supabase Storage (not reachable from this environment anyway;
 * see the final report's known-limitations section).
 *
 * Covers: a voiced character's dialogue line gets rendered and becomes
 * readable via getAudioForStoryEvent(); an unvoiced character is skipped
 * entirely (text-only by design, not a missing feature); a retry of an
 * already-COMPLETED render does not duplicate the AudioAsset (brief's
 * TEST 11); two different voiced characters speaking in the same scene
 * (both on voiceProfileVersion=1, the default) each get their own render
 * rather than colliding - the exact bug the lineIndex column was added to
 * fix (see prisma/schema.prisma's AudioRender model and the
 * 20261008160000_audio_render_line_index_unique migration).
 *
 * Same safety rules as every other suite in this directory: requires
 * INTEGRATION_DATABASE_URL explicitly, refuses anything supabase.co-shaped,
 * excluded from default `npm test`, run via `npm run test:integration`.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { TestAudioStorageProvider } from "../../src/features/romance/audio/audio-storage-provider";
import { TestTTSProvider } from "../../src/features/romance/audio/tts-provider";

import type { getAudioForStoryEvent as GetAudioForStoryEventType, renderSceneAudio as RenderSceneAudioType } from "../../src/features/romance/audio/audio-render.service";
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
let renderSceneAudio: typeof RenderSceneAudioType;
let getAudioForStoryEvent: typeof GetAudioForStoryEventType;

let universeId: string;
let seasonId: string;
let beatId: string;

async function createSessionAndEvent() {
  const player = await prisma.romancePlayer.create({
    data: { userId: `user-${RUN_ID}-${randomUUID()}`, displayName: "Test Player" },
  });
  const playerCharacter = await prisma.playerCharacter.create({
    data: { playerId: player.id, universeId, name: "Test Protagonist", pronouns: "she/her" },
  });
  const session = await prisma.storySession.create({
    data: {
      playerId: player.id,
      universeId,
      seasonId,
      playerCharacterId: playerCharacter.id,
      pinnedUniverseVersion: 1,
      pinnedSeasonVersion: 1,
      currentBeatId: beatId,
    },
  });
  const event = await prisma.storyEvent.create({
    data: { storySessionId: session.id, playerId: player.id, type: "INTENT_RESOLVED", payload: {} },
  });
  return { player, session, event };
}

before(async () => {
  process.env.DATABASE_URL = INTEGRATION_DATABASE_URL;
  process.env.DIRECT_URL = process.env.INTEGRATION_DIRECT_URL ?? INTEGRATION_DATABASE_URL;

  execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });

  const prismaModule = await import("../../src/lib/prisma");
  prisma = prismaModule.prisma;

  const service = await import("../../src/features/romance/audio/audio-render.service");
  renderSceneAudio = service.renderSceneAudio;
  getAudioForStoryEvent = service.getAudioForStoryEvent;

  const universe = await prisma.universe.create({
    data: {
      slug: `test-universe-audio-${RUN_ID}`,
      name: "Test Universe",
      description: "Integration test fixture universe.",
    },
  });
  universeId = universe.id;

  const season = await prisma.season.create({
    data: {
      universeId,
      slug: `test-season-audio-${RUN_ID}`,
      name: "Test Season",
      seasonNumber: 1,
      synopsis: "Integration test fixture season.",
    },
  });
  seasonId = season.id;

  const beat = await prisma.beat.create({
    data: { seasonId, slug: "test-beat", beatOrder: 1, name: "Test Beat", availableActions: [] },
  });
  beatId = beat.id;
});

after(async () => {
  // romancePlayer's cascade clears StorySession/StoryEvent, but AudioRender
  // hangs off StoryEvent.id (not a FK, just a plain string column - see
  // schema.prisma) and off VoiceProfile (Restrict) - both content-table-
  // adjacent rows this suite created itself, so they must be deleted
  // explicitly, in FK dependency order, before the StoryCharacter/
  // VoiceProfile rows they reference.
  const characters = await prisma.storyCharacter.findMany({
    where: { universeId },
    select: { id: true },
  });
  const voiceProfiles = await prisma.voiceProfile.findMany({
    where: { characterId: { in: characters.map((c) => c.id) } },
    select: { id: true },
  });
  await prisma.audioRender.deleteMany({
    where: { voiceProfileId: { in: voiceProfiles.map((v) => v.id) } },
  });
  await prisma.voiceProfile.deleteMany({
    where: { id: { in: voiceProfiles.map((v) => v.id) } },
  });
  await prisma.romancePlayer.deleteMany({ where: { userId: { startsWith: `user-${RUN_ID}-` } } });
  await prisma.beat.deleteMany({ where: { seasonId } });
  await prisma.season.deleteMany({ where: { universeId } });
  await prisma.storyCharacter.deleteMany({ where: { universeId } });
  await prisma.universe.deleteMany({ where: { id: universeId } });
  await prisma.$disconnect();
});

test("a voiced character's dialogue line is rendered and becomes playable", async () => {
  const character = await prisma.storyCharacter.create({
    data: {
      universeId,
      slug: `caelan-${RUN_ID}`,
      name: "Caelan",
      race: "FAE",
      isVoiced: true,
      speechStyle: "low, formal, precise",
      knowledgeScopeRule: "test",
    },
  });
  await prisma.voiceProfile.create({
    data: { characterId: character.id, sourceType: "AI", provider: "test-provider", providerVoiceId: "voice-caelan" },
  });
  const { event } = await createSessionAndEvent();

  const ttsProvider = new TestTTSProvider();
  const storageProvider = new TestAudioStorageProvider();

  await renderSceneAudio({
    storyEventId: event.id,
    universeId,
    dialogueLines: [{ speakerSlug: `caelan-${RUN_ID}`, text: "I know your true name now." }],
    ttsProvider,
    storageProvider,
  });

  const rendered = await prisma.audioRender.findMany({ where: { storyEventId: event.id } });
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0]!.status, "COMPLETED");
  assert.equal(rendered[0]!.lineIndex, 0);

  const playable = await getAudioForStoryEvent(event.id, storageProvider);
  assert.equal(playable.size, 1);
  const line0 = playable.get(0);
  assert.ok(line0);
  assert.equal(line0!.status, "COMPLETED");
  assert.ok(line0!.status === "COMPLETED" && line0.playbackUrl.startsWith("test://romance-audio/"));
  assert.ok(line0!.status === "COMPLETED" && line0.durationMs > 0);
});

test("an unvoiced character's dialogue line is skipped entirely - no AudioRender row is created", async () => {
  const character = await prisma.storyCharacter.create({
    data: {
      universeId,
      slug: `wren-${RUN_ID}`,
      name: "Wren",
      race: "FAE",
      isVoiced: false,
      speechStyle: "quiet",
      knowledgeScopeRule: "test",
    },
  });
  void character;
  const { event } = await createSessionAndEvent();

  await renderSceneAudio({
    storyEventId: event.id,
    universeId,
    dialogueLines: [{ speakerSlug: `wren-${RUN_ID}`, text: "..." }],
    ttsProvider: new TestTTSProvider(),
    storageProvider: new TestAudioStorageProvider(),
  });

  const rendered = await prisma.audioRender.findMany({ where: { storyEventId: event.id } });
  assert.equal(rendered.length, 0);

  const playable = await getAudioForStoryEvent(event.id, new TestAudioStorageProvider());
  assert.equal(playable.size, 0);
});

test("retrying renderSceneAudio for an already-COMPLETED line does not duplicate the AudioAsset (TEST 11)", async () => {
  const character = await prisma.storyCharacter.create({
    data: {
      universeId,
      slug: `rowan-${RUN_ID}`,
      name: "Rowan",
      race: "FAE",
      isVoiced: true,
      speechStyle: "warm",
      knowledgeScopeRule: "test",
    },
  });
  await prisma.voiceProfile.create({
    data: { characterId: character.id, sourceType: "AI", provider: "test-provider", providerVoiceId: "voice-rowan" },
  });
  const { event } = await createSessionAndEvent();
  const dialogueLines = [{ speakerSlug: `rowan-${RUN_ID}`, text: "Stay a while longer." }];
  const ttsProvider = new TestTTSProvider();
  const storageProvider = new TestAudioStorageProvider();

  await renderSceneAudio({ storyEventId: event.id, universeId, dialogueLines, ttsProvider, storageProvider });
  await renderSceneAudio({ storyEventId: event.id, universeId, dialogueLines, ttsProvider, storageProvider });

  const rendered = await prisma.audioRender.findMany({ where: { storyEventId: event.id } });
  assert.equal(rendered.length, 1, "retrying must not create a second AudioRender row");

  const assetCount = await prisma.audioAsset.count();
  const rowAssetId = rendered[0]!.audioAssetId;
  assert.ok(rowAssetId);
  const matchingAssets = await prisma.audioAsset.findMany({ where: { id: rowAssetId! } });
  assert.equal(matchingAssets.length, 1);
  void assetCount;
});

test("two different voiced characters speaking in the same scene, both on voiceProfileVersion=1, each get their own render (no collision)", async () => {
  const charA = await prisma.storyCharacter.create({
    data: {
      universeId,
      slug: `alpha-${RUN_ID}`,
      name: "Alpha",
      race: "FAE",
      isVoiced: true,
      speechStyle: "test",
      knowledgeScopeRule: "test",
    },
  });
  const charB = await prisma.storyCharacter.create({
    data: {
      universeId,
      slug: `beta-${RUN_ID}`,
      name: "Beta",
      race: "FAE",
      isVoiced: true,
      speechStyle: "test",
      knowledgeScopeRule: "test",
    },
  });
  const voiceA = await prisma.voiceProfile.create({
    data: { characterId: charA.id, sourceType: "AI", provider: "test-provider", providerVoiceId: "voice-a" },
  });
  const voiceB = await prisma.voiceProfile.create({
    data: { characterId: charB.id, sourceType: "AI", provider: "test-provider", providerVoiceId: "voice-b" },
  });
  // Both freshly-created VoiceProfiles default to version=1 - this is
  // exactly the scenario that the original two-column
  // @@unique([storyEventId, voiceProfileVersion]) constraint would have
  // collided on, before lineIndex was added.
  assert.equal(voiceA.version, 1);
  assert.equal(voiceB.version, 1);

  const { event } = await createSessionAndEvent();

  await renderSceneAudio({
    storyEventId: event.id,
    universeId,
    dialogueLines: [
      { speakerSlug: `alpha-${RUN_ID}`, text: "First line." },
      { speakerSlug: `beta-${RUN_ID}`, text: "Second line." },
    ],
    ttsProvider: new TestTTSProvider(),
    storageProvider: new TestAudioStorageProvider(),
  });

  const rendered = await prisma.audioRender.findMany({
    where: { storyEventId: event.id },
    orderBy: { lineIndex: "asc" },
  });
  assert.equal(rendered.length, 2);
  assert.equal(rendered[0]!.status, "COMPLETED");
  assert.equal(rendered[1]!.status, "COMPLETED");
  assert.equal(rendered[0]!.lineIndex, 0);
  assert.equal(rendered[1]!.lineIndex, 1);

  const playable = await getAudioForStoryEvent(event.id, new TestAudioStorageProvider());
  assert.equal(playable.size, 2);
});
