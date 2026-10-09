import type { PrismaClient } from "@prisma/client";

/**
 * Shared seeding logic for the Romance Engine's first real content
 * package ("Thornbound"). Extracted from prisma/seed-romance.ts so the
 * exact same logic can run either as a standalone script (local/CI) or
 * from the one-time admin seed route (src/app/api/romance/admin-seed) -
 * never two copies of the content to drift apart.
 *
 * Deliberately no "server-only" guard here (unlike most of
 * src/features/romance/**) - that import breaks the plain `tsx`
 * invocation prisma/seed-romance.ts relies on (same issue documented on
 * romance-player.service.ts/romance-player-guards.ts). This module takes
 * a PrismaClient instance rather than importing one, so it has no
 * meaningful client-bundle risk to guard against.
 */

const UNIVERSE_SLUG = "thornbound";
const SEASON_ONE_SLUG = "season-one";
const SEASON_TWO_SLUG = "season-two";

type BeatExitRule = {
  onEventType: string;
  next: string | null;
  minOccurrencesInBeat?: number;
  completesSession?: boolean;
};

function exitRules(rules: BeatExitRule[]) {
  return rules as unknown as object;
}

interface BeatDefinition {
  slug: string;
  beatOrder: number;
  name: string;
  entryConditions: object;
  exitConditions: BeatExitRule[];
  availableActions: string[];
  stateEffects: object;
  characterInvolvement: string[];
  canonFactTemplates: object;
  isFailState: boolean;
}

async function upsertBeatsForSeason(
  prisma: PrismaClient,
  seasonId: string,
  beats: BeatDefinition[]
): Promise<void> {
  for (const beat of beats) {
    await prisma.beat.upsert({
      where: { seasonId_slug_version: { seasonId, slug: beat.slug, version: 1 } },
      create: {
        seasonId,
        slug: beat.slug,
        beatOrder: beat.beatOrder,
        name: beat.name,
        entryConditions: beat.entryConditions,
        exitConditions: exitRules(beat.exitConditions),
        availableActions: beat.availableActions,
        stateEffects: beat.stateEffects,
        characterInvolvement: beat.characterInvolvement,
        canonFactTemplates: beat.canonFactTemplates,
        isFailState: beat.isFailState,
        version: 1,
      },
      update: {
        entryConditions: beat.entryConditions,
        exitConditions: exitRules(beat.exitConditions),
        availableActions: beat.availableActions,
        stateEffects: beat.stateEffects,
        characterInvolvement: beat.characterInvolvement,
        canonFactTemplates: beat.canonFactTemplates,
      },
    });
  }
}

export async function seedRomanceContent(
  prisma: PrismaClient
): Promise<{ universeName: string; universeSlug: string; universeVersion: number; beatCount: number }> {
  const universe = await prisma.universe.upsert({
    where: { slug_version: { slug: UNIVERSE_SLUG, version: 1 } },
    create: {
      slug: UNIVERSE_SLUG,
      name: "Thornbound",
      version: 1,
      status: "PUBLISHED",
      description:
        "Pulled across the border into a Fae court that runs on older, " +
        "stricter rules than the one you left, you find yourself bound to " +
        "a lord who never lies - and never tells the whole truth either.",
    },
    update: {},
  });

  const season = await prisma.season.upsert({
    where: {
      universeId_slug_version: {
        universeId: universe.id,
        slug: SEASON_ONE_SLUG,
        version: 1,
      },
    },
    create: {
      universeId: universe.id,
      slug: SEASON_ONE_SLUG,
      name: "Season One: The Bargain",
      seasonNumber: 1,
      version: 1,
      status: "PUBLISHED",
      synopsis:
        "A mortal woman is pulled across the border into the Thorn Court. " +
        "To survive it, she will have to bargain with its lord - and learn " +
        "exactly what Fae bargains cost.",
    },
    update: {},
  });

  const seasonTwo = await prisma.season.upsert({
    where: {
      universeId_slug_version: {
        universeId: universe.id,
        slug: SEASON_TWO_SLUG,
        version: 1,
      },
    },
    create: {
      universeId: universe.id,
      slug: SEASON_TWO_SLUG,
      name: "Season Two: The Thorn Debt",
      seasonNumber: 2,
      version: 1,
      status: "PUBLISHED",
      synopsis:
        "The Wild Hunt has not forgotten what the Thorn Court owes it. As " +
        "Rowan comes to collect Caelan's debt, whispers spread that someone " +
        "at court has started asking after his true name - and the price of " +
        "learning it may fall on you.",
    },
    update: {},
  });

  const seasonOneBeats: BeatDefinition[] = [
    {
      slug: "awakening",
      beatOrder: 1,
      name: "Awakening",
      entryConditions: {},
      exitConditions: [
        { onEventType: "INTENT_RESOLVED", next: "bargain", minOccurrencesInBeat: 2 },
      ],
      availableActions: ["ASK_QUESTION", "GENERIC_ACTION", "REVEAL_TRUE_NAME", "PROMISE"],
      stateEffects: {},
      characterInvolvement: ["caelan"],
      canonFactTemplates: [],
      isFailState: false,
    },
    {
      slug: "bargain",
      beatOrder: 2,
      name: "The Bargain",
      entryConditions: { requiresBeat: "awakening" },
      exitConditions: [
        { onEventType: "BARGAIN_SEALED", next: "first_choice" },
        { onEventType: "BARGAIN_BROKEN", next: "first_choice" },
      ],
      availableActions: [
        "ASK_QUESTION",
        "GENERIC_ACTION",
        "REVEAL_TRUE_NAME",
        "PROMISE",
        "PROPOSE_BARGAIN",
        "ACCEPT_BARGAIN",
        "BREAK_BARGAIN",
      ],
      stateEffects: {},
      characterInvolvement: ["caelan"],
      canonFactTemplates: [],
      isFailState: false,
    },
    {
      slug: "first_choice",
      beatOrder: 3,
      name: "The First Choice",
      entryConditions: { requiresBeat: "bargain" },
      exitConditions: [
        { onEventType: "INTENT_RESOLVED", next: "hunt", minOccurrencesInBeat: 2 },
      ],
      availableActions: ["ASK_QUESTION", "GENERIC_ACTION", "REVEAL_TRUE_NAME", "PROMISE"],
      stateEffects: {},
      characterInvolvement: ["caelan", "wren"],
      canonFactTemplates: [],
      isFailState: false,
    },
    {
      slug: "hunt",
      beatOrder: 4,
      name: "The Wild Hunt",
      entryConditions: { requiresBeat: "first_choice" },
      exitConditions: [
        { onEventType: "INTENT_RESOLVED", next: "revelation", minOccurrencesInBeat: 2 },
      ],
      availableActions: [
        "ASK_QUESTION",
        "GENERIC_ACTION",
        "PROMISE",
        "PROPOSE_BARGAIN",
        "ACCEPT_BARGAIN",
        "BREAK_BARGAIN",
      ],
      stateEffects: { fear: 10 },
      characterInvolvement: ["caelan", "rival"],
      canonFactTemplates: [],
      isFailState: false,
    },
    {
      slug: "revelation",
      beatOrder: 5,
      name: "Revelation",
      entryConditions: { requiresBeat: "hunt" },
      exitConditions: [
        { onEventType: "INTENT_RESOLVED", next: "blood_moon", minOccurrencesInBeat: 2 },
      ],
      availableActions: ["ASK_QUESTION", "GENERIC_ACTION", "REVEAL_TRUE_NAME", "PROMISE"],
      stateEffects: {},
      characterInvolvement: ["caelan"],
      canonFactTemplates: [
        { factType: "CHARACTER_KNOWLEDGE", subject: "caelan", content: "the nature of his own binding is revealed to the player" },
      ],
      isFailState: false,
    },
    {
      slug: "blood_moon",
      beatOrder: 6,
      name: "Blood Moon",
      entryConditions: { requiresBeat: "revelation" },
      exitConditions: [
        { onEventType: "INTENT_RESOLVED", next: "season_finale", minOccurrencesInBeat: 2 },
      ],
      availableActions: [
        "ASK_QUESTION",
        "GENERIC_ACTION",
        "PROMISE",
        "PROPOSE_BARGAIN",
        "ACCEPT_BARGAIN",
        "BREAK_BARGAIN",
      ],
      stateEffects: {},
      characterInvolvement: ["caelan", "rival"],
      canonFactTemplates: [],
      isFailState: false,
    },
    {
      slug: "season_finale",
      beatOrder: 7,
      name: "Season Finale",
      entryConditions: { requiresBeat: "blood_moon" },
      exitConditions: [
        { onEventType: "INTENT_RESOLVED", next: null, minOccurrencesInBeat: 3, completesSession: true },
      ],
      availableActions: ["ASK_QUESTION", "GENERIC_ACTION", "REVEAL_TRUE_NAME", "PROMISE"],
      stateEffects: {},
      characterInvolvement: ["caelan", "rival", "wren"],
      canonFactTemplates: [],
      isFailState: false,
    },
  ];

  await upsertBeatsForSeason(prisma, season.id, seasonOneBeats);

  // Season Two picks up directly after Season One's finale: Caelan's
  // binding was revealed there but his debt to the Wild Hunt (via Rowan)
  // was never settled, and his true name - established in Season One as
  // "never revealed... a Season 2 hook" - starts to matter again as the
  // court takes notice. Same cast, continuing arcs (ADR/Product Bible's
  // "second season" post-MVP item) - no new characters, so no new voice
  // assignments needed either.
  const seasonTwoBeats: BeatDefinition[] = [
    {
      slug: "return",
      beatOrder: 1,
      name: "The Return",
      entryConditions: {},
      exitConditions: [
        { onEventType: "INTENT_RESOLVED", next: "the_debt", minOccurrencesInBeat: 2 },
      ],
      availableActions: ["ASK_QUESTION", "GENERIC_ACTION", "REVEAL_TRUE_NAME", "PROMISE"],
      stateEffects: {},
      characterInvolvement: ["caelan", "wren"],
      canonFactTemplates: [],
      isFailState: false,
    },
    {
      slug: "the_debt",
      beatOrder: 2,
      name: "The Hunt's Debt",
      entryConditions: { requiresBeat: "return" },
      exitConditions: [
        { onEventType: "BARGAIN_SEALED", next: "whispers" },
        { onEventType: "BARGAIN_BROKEN", next: "whispers" },
      ],
      availableActions: [
        "ASK_QUESTION",
        "GENERIC_ACTION",
        "REVEAL_TRUE_NAME",
        "PROMISE",
        "PROPOSE_BARGAIN",
        "ACCEPT_BARGAIN",
        "BREAK_BARGAIN",
      ],
      stateEffects: {},
      characterInvolvement: ["caelan", "rival"],
      canonFactTemplates: [],
      isFailState: false,
    },
    {
      slug: "whispers",
      beatOrder: 3,
      name: "Court Whispers",
      entryConditions: { requiresBeat: "the_debt" },
      exitConditions: [
        { onEventType: "INTENT_RESOLVED", next: "the_offer", minOccurrencesInBeat: 2 },
      ],
      availableActions: ["ASK_QUESTION", "GENERIC_ACTION", "REVEAL_TRUE_NAME", "PROMISE"],
      stateEffects: {},
      characterInvolvement: ["caelan", "wren"],
      canonFactTemplates: [
        {
          factType: "CHARACTER_KNOWLEDGE",
          subject: "caelan",
          content: "someone at court has begun asking after his true name",
        },
      ],
      isFailState: false,
    },
    {
      slug: "the_offer",
      beatOrder: 4,
      name: "The Offer",
      entryConditions: { requiresBeat: "whispers" },
      exitConditions: [
        { onEventType: "BARGAIN_SEALED", next: "blood_price" },
        { onEventType: "BARGAIN_BROKEN", next: "blood_price" },
      ],
      availableActions: [
        "ASK_QUESTION",
        "GENERIC_ACTION",
        "PROMISE",
        "PROPOSE_BARGAIN",
        "ACCEPT_BARGAIN",
        "BREAK_BARGAIN",
      ],
      stateEffects: {},
      characterInvolvement: ["caelan", "rival"],
      canonFactTemplates: [],
      isFailState: false,
    },
    {
      slug: "blood_price",
      beatOrder: 5,
      name: "Blood Price",
      entryConditions: { requiresBeat: "the_offer" },
      exitConditions: [
        { onEventType: "INTENT_RESOLVED", next: "the_reckoning", minOccurrencesInBeat: 2 },
      ],
      availableActions: [
        "ASK_QUESTION",
        "GENERIC_ACTION",
        "PROMISE",
        "PROPOSE_BARGAIN",
        "ACCEPT_BARGAIN",
        "BREAK_BARGAIN",
      ],
      stateEffects: { fear: 10 },
      characterInvolvement: ["caelan", "rival", "wren"],
      canonFactTemplates: [],
      isFailState: false,
    },
    {
      slug: "the_reckoning",
      beatOrder: 6,
      name: "The Reckoning",
      entryConditions: { requiresBeat: "blood_price" },
      exitConditions: [
        { onEventType: "INTENT_RESOLVED", next: "season_two_finale", minOccurrencesInBeat: 2 },
      ],
      availableActions: ["ASK_QUESTION", "GENERIC_ACTION", "REVEAL_TRUE_NAME", "PROMISE"],
      stateEffects: {},
      characterInvolvement: ["caelan", "rival", "wren"],
      canonFactTemplates: [],
      isFailState: false,
    },
    {
      slug: "season_two_finale",
      beatOrder: 7,
      name: "Season Two Finale",
      entryConditions: { requiresBeat: "the_reckoning" },
      exitConditions: [
        { onEventType: "INTENT_RESOLVED", next: null, minOccurrencesInBeat: 3, completesSession: true },
      ],
      availableActions: ["ASK_QUESTION", "GENERIC_ACTION", "REVEAL_TRUE_NAME", "PROMISE"],
      stateEffects: {},
      characterInvolvement: ["caelan", "rival", "wren"],
      canonFactTemplates: [],
      isFailState: false,
    },
  ];

  await upsertBeatsForSeason(prisma, seasonTwo.id, seasonTwoBeats);

  const caelan = await prisma.storyCharacter.upsert({
    where: { universeId_slug_version: { universeId: universe.id, slug: "caelan", version: 1 } },
    create: {
      universeId: universe.id,
      slug: "caelan",
      name: "Caelan",
      race: "FAE",
      isAdult: true,
      isVoiced: true,
      personality: { traits: ["controlled", "wry", "dangerous-charming"], crackPoint: "player" },
      goals: ["BREAK_HIS_OWN_BINDING", "PROTECT_THE_COURT", "KEEP_HIS_TRUE_NAME_HIDDEN"],
      fears: ["LOSING_CONTROL", "BEING_NAMED_AND_COMMANDED"],
      values: ["WORD_IS_BINDING", "THE_COURT_BEFORE_HIMSELF"],
      speechStyle: "Formal cadence, rarely contracts words, dry understatement under pressure.",
      forbiddenBehavior: [
        "NEVER_KNOWINGLY_LIES",
        "NEVER_CLAIMS_KNOWLEDGE_OUTSIDE_SCOPE",
        "NEVER_REFERENCES_UNTOLD_PLAYER_FACT",
      ],
      knowledgeScopeRule:
        "Knows only common Fae-court knowledge, what he has witnessed directly in this " +
        "session, or what the player has told him in-fiction (tracked as RomanceMemory " +
        "rows with relatedCharacterSlug=caelan). Cannot know the player's true name " +
        "unless a CanonFact records it was revealed to him specifically (CANON-004).",
      version: 1,
    },
    update: { isAdult: true },
  });

  await prisma.characterSecret.upsert({
    where: { characterId_secretKey: { characterId: caelan.id, secretKey: "HIS_TRUE_NAME" } },
    create: {
      characterId: caelan.id,
      secretKey: "HIS_TRUE_NAME",
      content: "Caelan's true name - never revealed in Season 1 (a Season 2 hook).",
      revealConditionBeatSlug: null,
    },
    update: {},
  });

  await prisma.characterSecret.upsert({
    where: {
      characterId_secretKey: { characterId: caelan.id, secretKey: "THE_NATURE_OF_HIS_OWN_BINDING" },
    },
    create: {
      characterId: caelan.id,
      secretKey: "THE_NATURE_OF_HIS_OWN_BINDING",
      content: "The old bargain that binds Caelan to the Thorn Court.",
      revealConditionBeatSlug: "revelation",
    },
    update: {},
  });

  const rival = await prisma.storyCharacter.upsert({
    where: { universeId_slug_version: { universeId: universe.id, slug: "rival", version: 1 } },
    create: {
      universeId: universe.id,
      slug: "rival",
      name: "Rowan",
      race: "FAE",
      isAdult: true,
      isVoiced: true,
      personality: { traits: ["clipped", "mocking", "watchful"] },
      goals: ["COLLECT_THE_HUNTS_DEBT", "TEST_THE_PLAYER"],
      fears: ["LOSING_THE_HUNTS_RESPECT"],
      values: ["THE_HUNT_IS_OWED"],
      speechStyle: "Clipped, mocking, needles for weakness.",
      forbiddenBehavior: [
        "NEVER_KNOWINGLY_LIES",
        "NEVER_CLAIMS_KNOWLEDGE_OUTSIDE_SCOPE",
      ],
      knowledgeScopeRule:
        "Knows what the Wild Hunt knows, what he has witnessed directly, or what the " +
        "player has told him in-fiction. Holds a legitimate debt claim against Caelan.",
      version: 1,
    },
    update: { isAdult: true },
  });

  await prisma.storyCharacter.upsert({
    where: { universeId_slug_version: { universeId: universe.id, slug: "wren", version: 1 } },
    create: {
      universeId: universe.id,
      slug: "wren",
      name: "Wren",
      race: "HALF_FAE",
      isAdult: true,
      isVoiced: false,
      personality: { traits: ["quiet", "observant", "loyal once trust is earned"] },
      goals: ["REPAY_DEBT_TO_PLAYER", "SURVIVE_COURT_POLITICS"],
      fears: ["BEING_NOTICED_BY_THE_COURT"],
      values: ["DEBTS_ARE_REPAID"],
      speechStyle: "Says little; text-only in Season 1 (no voiced dialogue).",
      forbiddenBehavior: ["NEVER_KNOWINGLY_LIES"],
      knowledgeScopeRule:
        "A half-Fae servant of the Thorn Court; knows court routines and gossip, not its " +
        "lord's secrets.",
      version: 1,
    },
    update: { isAdult: true },
  });

  // OpenAI tts-1 voices, picked for each character's established
  // speechStyle above (onyx: deep/formal, matches Caelan's controlled
  // cadence; echo: a distinct male voice, matches Rowan's clipped
  // mocking tone). version=2 so a VoiceProfile row created before this
  // change (provider="unconfigured", version=1) is recognized as stale
  // and updated, per this file's established versioned-content
  // convention - never silently overwritten in place.
  const voiceAssignments: Array<{ character: typeof caelan; providerVoiceId: string }> = [
    { character: caelan, providerVoiceId: "onyx" },
    { character: rival, providerVoiceId: "echo" },
  ];
  for (const { character, providerVoiceId } of voiceAssignments) {
    await prisma.voiceProfile.upsert({
      where: { characterId: character.id },
      create: {
        characterId: character.id,
        sourceType: "AI",
        provider: "openai",
        providerVoiceId,
        version: 2,
      },
      update: {
        sourceType: "AI",
        provider: "openai",
        providerVoiceId,
        version: 2,
      },
    });
  }

  return {
    universeName: universe.name,
    universeSlug: universe.slug,
    universeVersion: universe.version,
    beatCount: seasonOneBeats.length + seasonTwoBeats.length,
  };
}
