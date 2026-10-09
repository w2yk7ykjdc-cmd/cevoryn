import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { isPlausibleVerificationTimestamp } from "../player/age-gate-math";

import {
  deriveBeatTransitionEventType,
  evaluateBeatTransition,
} from "./beat-transition-math";
import type { BeatExitRule } from "./beat-transition-math";
import { canTransitionBargain } from "./commitment-fsm-math";
import { parseFreeformIntent } from "./intent-parser-math";
import { resolveMemoryWrite } from "./memory-dedup-math";
import { getSceneProvider } from "./openai-scene-provider";
import { getSceneSafetyClassifier } from "./openai-scene-safety-classifier";
import { getRelationshipDelta } from "./relationship-transition-math";
import type {
  LLMProvider,
  SceneGenerationContext,
  StructuredSceneOutput,
} from "./scene-generation-provider";
import { selectValidSceneMemoryCandidates } from "./scene-memory-candidate-math";
import { generateValidatedScene } from "./scene-pipeline.service";
import { containsSuspectedChildSexualText } from "./scene-safety-policy";
import type { SceneSafetyClassifier, SceneSafetyContext } from "./scene-safety-policy";
import type { SceneFailureReason } from "./scene-pipeline.service";
import type {
  CanonContext,
  MemoryLite,
  RelationshipDimensionKey,
  RelationshipEventCause,
  StructuredIntent,
} from "./types";

/** CanonFact.content prefix written by REVEAL_TRUE_NAME - shared between the writer and the CanonContext reader below so they can never drift apart. */
const TRUE_NAME_REVEAL_PREFIX = "player revealed true name:";

/** StoryCharacter.personality is an untyped Json column (seed shape: `{ traits: string[], crackPoint?: string }`) - extracts just the traits array defensively, since a malformed/missing field here must never break scene generation. */
function extractPersonalityTraits(personality: unknown): string[] {
  if (typeof personality !== "object" || personality === null) return [];
  const traits = (personality as Record<string, unknown>).traits;
  return Array.isArray(traits) ? traits.filter((t): t is string => typeof t === "string") : [];
}

/**
 * Romance Story Engine orchestration - the server-only wrapper around the
 * pure deterministic layer (intent-parser-math, canon-validator-math,
 * relationship-transition-math, commitment-fsm-math, memory-dedup-math,
 * beat-transition-math) plus the scene-generation pipeline
 * (scene-generation-provider.ts, scene-pipeline.service.ts). See
 * docs/romance/02-STORY_ENGINE_BIBLE.md §7 for the full pipeline this
 * implements: USER INPUT -> INTENT PARSER -> VALIDATION -> STATE
 * TRANSITION -> SCENE GENERATION -> CANON VALIDATION -> MEMORY
 * EXTRACTION -> STATE COMMIT -> BEAT ADVANCE.
 *
 * Every accepted intent gets a generated, canon-validated scene (the
 * player-facing narration/dialogue) - the deterministic state transition
 * above always runs first and owns the facts; the LLM only narrates
 * within them. For PROMISE/REVEAL_TRUE_NAME/bargain actions (which
 * already have their own deterministic relationship effect), the scene's
 * proposedRelationshipNudge is ignored to avoid double-applying a delta;
 * for ASK_QUESTION/GENERIC_ACTION (which have no other effect) it is the
 * only relationship signal, and even then the engine - not the model -
 * owns the fixed magnitude (relationship-transition-math.ts).
 *
 * Production scene generation (OpenAISceneProvider) is real code but not
 * exercised against a real model in this sandbox - no OPENAI_API_KEY
 * exists here, so getSceneProvider() falls back to the deterministic
 * TestSceneProvider by default. See the final report's known-limitations
 * section; this is not hidden or reported as "working against a real LLM".
 */

export class RomanceStoryNotFoundError extends Error {
  constructor() {
    super("Story session not found for this player.");
    this.name = "RomanceStoryNotFoundError";
  }
}

export class RomanceValidationError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "RomanceValidationError";
  }
}

export interface SubmitPlayerInputParams {
  playerId: string;
  storySessionId: string;
  rawInput: string;
  /** The character the player is addressing - required for actions that target one. */
  targetCharacterSlug?: string;
  /** Required when the parsed intent is PROPOSE_BARGAIN - never fabricated by the engine. */
  bargainBreachConsequence?: string;
  /** Swappable provider (brief §26) - defaults to getSceneProvider(). Tests inject a TestSceneProvider with a custom plan. */
  llmProvider?: LLMProvider;
  /** Injectable structured safety classifier; absent in production, the configured classifier is required. */
  sceneSafetyClassifier?: SceneSafetyClassifier;
  /** Client-generated key - a retried/duplicate submission (double-click, network retry) with the same key returns the original result instead of reprocessing. */
  idempotencyKey?: string;
}

export type SubmitPlayerInputResult =
  | {
      accepted: true;
      intent: StructuredIntent;
      storyEventId: string;
      /** Needed by the caller to schedule renderSceneAudio() post-response (brief §20) without a second DB round trip. */
      universeId: string;
      scene: StructuredSceneOutput;
      sceneFailureReason: SceneFailureReason | null;
      beatAdvancedTo: string | null;
      /** The new beat's display name, e.g. for a UI/notification - beatAdvancedTo itself stays a slug (test/API contract). */
      beatAdvancedToName: string | null;
      sessionCompleted: boolean;
      relationshipChanges: Array<{
        dimension: RelationshipDimensionKey;
        previousValue: number;
        newValue: number;
      }> | null;
    }
  | { accepted: false; intent: StructuredIntent; reason: string };

/**
 * Tenant-scoped loader - the only way this service ever reads a
 * StorySession. Scoping by `playerId` in the WHERE clause (not just
 * checking afterward) is the same discipline this codebase's prior audit
 * verified for every `organizationId`-scoped service: a session that
 * exists but belongs to a different player returns null, identically to
 * one that does not exist at all, so a caller can never distinguish
 * "not yours" from "doesn't exist".
 */
export async function loadSessionForPlayer(
  playerId: string,
  storySessionId: string
) {
  return prisma.storySession.findFirst({
    where: { id: storySessionId, playerId },
    include: { currentBeat: true },
  });
}

async function getActiveMemoriesForSignature(
  storySessionId: string,
  type: string,
  subject: string,
  object: string | null
): Promise<MemoryLite[]> {
  const rows = await prisma.romanceMemory.findMany({
    where: {
      storySessionId,
      status: "ACTIVE",
      type: type as never,
      subject,
      object,
    },
    select: {
      id: true,
      type: true,
      subject: true,
      object: true,
      content: true,
      status: true,
    },
  });
  return rows;
}

async function writeMemory(
  tx: Prisma.TransactionClient,
  params: {
    storySessionId: string;
    playerId: string;
    type: string;
    subject: string;
    object: string | null;
    content: string;
    source: string;
    relatedCharacterSlug?: string | null;
  }
): Promise<void> {
  const existing = await getActiveMemoriesForSignature(
    params.storySessionId,
    params.type,
    params.subject,
    params.object
  );
  const decision = resolveMemoryWrite(existing, {
    type: params.type,
    subject: params.subject,
    object: params.object,
    content: params.content,
  });

  if (decision.action === "SKIP_DUPLICATE") return;

  if (decision.action === "SUPERSEDE") {
    await tx.romanceMemory.update({
      where: { id: decision.supersedesId },
      data: { status: "SUPERSEDED" },
    });
  }

  await tx.romanceMemory.create({
    data: {
      storySessionId: params.storySessionId,
      playerId: params.playerId,
      type: params.type as never,
      subject: params.subject,
      object: params.object,
      content: params.content,
      source: params.source as never,
      relatedCharacterSlug: params.relatedCharacterSlug ?? null,
      supersedesId:
        decision.action === "SUPERSEDE" ? decision.supersedesId : null,
    },
  });
}

/**
 * Applies a relationship delta atomically, race-free under concurrent
 * writers. A CTE locks the row (FOR UPDATE) and captures its pre-update
 * values; the UPDATE...FROM references those captured values rather than
 * re-reading the table, so two concurrent causes against the same
 * (session, character) row each apply their own delta in full - neither
 * is lost to a read-modify-write race, and both results are clamped to
 * [0, 100] by the same statement that applies them.
 */
async function applyRelationshipDeltaAtomic(
  tx: Prisma.TransactionClient,
  storySessionId: string,
  playerId: string,
  characterSlug: string,
  cause: RelationshipEventCause
): Promise<
  Array<{
    dimension: RelationshipDimensionKey;
    previousValue: number;
    newValue: number;
  }>
> {
  const delta = getRelationshipDelta(cause);
  const d = {
    trust: delta.trust ?? 0,
    attraction: delta.attraction ?? 0,
    fear: delta.fear ?? 0,
    loyalty: delta.loyalty ?? 0,
    tension: delta.tension ?? 0,
  };

  // Same TOCTOU-closing technique as auth-rate-limit.service.ts::tryRecord():
  // a transaction-scoped advisory lock keyed by (storySessionId,
  // characterSlug) serializes concurrent callers that share a key, so two
  // simultaneous "first touch" writers for the same row can never both
  // race past the upsert's existence check and collide on the unique
  // constraint. Released automatically when the transaction ends.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${storySessionId}:${characterSlug}`}, 0))`;

  await tx.relationshipState.upsert({
    where: { storySessionId_characterSlug: { storySessionId, characterSlug } },
    create: { storySessionId, playerId, characterSlug },
    update: {},
  });

  const rows = await tx.$queryRaw<
    Array<{
      prev_trust: number;
      prev_attraction: number;
      prev_fear: number;
      prev_loyalty: number;
      prev_tension: number;
      new_trust: number;
      new_attraction: number;
      new_fear: number;
      new_loyalty: number;
      new_tension: number;
    }>
  >`
    WITH prev AS (
      SELECT trust, attraction, fear, loyalty, tension
      FROM "romance_relationship_states"
      WHERE "story_session_id" = ${storySessionId} AND "character_slug" = ${characterSlug}
      FOR UPDATE
    )
    UPDATE "romance_relationship_states" r
    SET
      trust = GREATEST(0, LEAST(100, prev.trust + ${d.trust})),
      attraction = GREATEST(0, LEAST(100, prev.attraction + ${d.attraction})),
      fear = GREATEST(0, LEAST(100, prev.fear + ${d.fear})),
      loyalty = GREATEST(0, LEAST(100, prev.loyalty + ${d.loyalty})),
      tension = GREATEST(0, LEAST(100, prev.tension + ${d.tension})),
      "updated_at" = now()
    FROM prev
    WHERE r."story_session_id" = ${storySessionId} AND r."character_slug" = ${characterSlug}
    RETURNING
      prev.trust AS prev_trust, prev.attraction AS prev_attraction, prev.fear AS prev_fear,
      prev.loyalty AS prev_loyalty, prev.tension AS prev_tension,
      r.trust AS new_trust, r.attraction AS new_attraction, r.fear AS new_fear,
      r.loyalty AS new_loyalty, r.tension AS new_tension
  `;

  const row = rows[0];
  if (!row) return [];

  const pairs: Array<[RelationshipDimensionKey, number, number]> = [
    ["trust", row.prev_trust, row.new_trust],
    ["attraction", row.prev_attraction, row.new_attraction],
    ["fear", row.prev_fear, row.new_fear],
    ["loyalty", row.prev_loyalty, row.new_loyalty],
    ["tension", row.prev_tension, row.new_tension],
  ];

  return pairs
    .filter(([, previousValue, newValue]) => previousValue !== newValue)
    .map(([dimension, previousValue, newValue]) => ({
      dimension,
      previousValue,
      newValue,
    }));
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value));
}

async function buildCanonContext(
  tx: Prisma.TransactionClient,
  storySessionId: string,
  universeId: string
): Promise<CanonContext> {
  const [trueNameFacts, bargains, promises, adultCharacters] = await Promise.all([
    tx.canonFact.findMany({
      where: {
        storySessionId,
        factType: "CHARACTER_KNOWLEDGE",
        content: { startsWith: TRUE_NAME_REVEAL_PREFIX },
      },
      select: { subject: true },
    }),
    tx.bargain.findMany({ where: { storySessionId }, select: { id: true } }),
    tx.promise.findMany({ where: { storySessionId }, select: { id: true } }),
    tx.storyCharacter.findMany({
      where: { universeId, isAdult: true },
      select: { slug: true },
    }),
  ]);

  return {
    trueNameRevealedTo: new Set(trueNameFacts.map((f) => f.subject)),
    knownBargainIds: new Set(bargains.map((b) => b.id)),
    knownPromiseIds: new Set(promises.map((p) => p.id)),
    adultCharacterSlugs: new Set(adultCharacters.map((c) => c.slug)),
  };
}

async function buildSceneSafetyContext(
  tx: Prisma.TransactionClient,
  universeId: string,
  playerId: string
): Promise<SceneSafetyContext> {
  const [characters, player] = await Promise.all([
    tx.storyCharacter.findMany({
      where: { universeId },
      select: {
        slug: true,
        isAdult: true,
        relationshipToPlayerSafety: true,
      },
    }),
    tx.romancePlayer.findUnique({
      where: { id: playerId },
      select: { ageVerifiedAt: true },
    }),
  ]);

  return {
    playerAdultVerified: isPlausibleVerificationTimestamp(
      player?.ageVerifiedAt ?? null
    ),
    characters: Object.fromEntries(
      characters.map((character) => [
        character.slug,
        {
          isAdult: character.isAdult,
          relationshipToPlayerSafety: character.relationshipToPlayerSafety,
        },
      ])
    ),
  };
}

async function buildSceneGenerationContext(
  tx: Prisma.TransactionClient,
  session: { id: string; universeId: string },
  beatSlug: string,
  beatName: string,
  intent: StructuredIntent,
  targetCharacterSlug: string | null
): Promise<SceneGenerationContext> {
  const RECENT_LIMIT = 5;

  const [memories, canonFacts, relationshipState, character] = await Promise.all([
    tx.romanceMemory.findMany({
      where: {
        storySessionId: session.id,
        status: "ACTIVE",
        ...(targetCharacterSlug && { relatedCharacterSlug: targetCharacterSlug }),
      },
      orderBy: { createdAt: "desc" },
      take: RECENT_LIMIT,
      select: { type: true, subject: true, object: true, content: true },
    }),
    tx.canonFact.findMany({
      where: { storySessionId: session.id },
      orderBy: { createdAt: "desc" },
      take: RECENT_LIMIT,
      select: { factType: true, subject: true, content: true },
    }),
    targetCharacterSlug
      ? tx.relationshipState.findUnique({
          where: {
            storySessionId_characterSlug: {
              storySessionId: session.id,
              characterSlug: targetCharacterSlug,
            },
          },
        })
      : Promise.resolve(null),
    targetCharacterSlug
      ? tx.storyCharacter.findFirst({
          where: { universeId: session.universeId, slug: targetCharacterSlug },
          select: {
            knowledgeScopeRule: true,
            speechStyle: true,
            personality: true,
            goals: true,
            fears: true,
            values: true,
          },
        })
      : Promise.resolve(null),
  ]);

  return {
    beatSlug,
    beatName,
    intent,
    targetCharacterSlug,
    relevantMemories: memories,
    relevantCanonFacts: canonFacts,
    relationshipState: relationshipState
      ? {
          trust: relationshipState.trust,
          attraction: relationshipState.attraction,
          fear: relationshipState.fear,
          loyalty: relationshipState.loyalty,
          tension: relationshipState.tension,
        }
      : null,
    characterVoice: character
      ? {
          speechStyle: character.speechStyle,
          personalityTraits: extractPersonalityTraits(character.personality),
          goals: character.goals,
          fears: character.fears,
          values: character.values,
        }
      : null,
    characterKnowledgeScope: character?.knowledgeScopeRule ?? null,
  };
}

async function recordRejection(
  storySessionId: string,
  playerId: string,
  beatId: string | null,
  intent: StructuredIntent,
  reason: string
): Promise<SubmitPlayerInputResult> {
  await prisma.storyEvent.create({
    data: {
      storySessionId,
      playerId,
      beatId,
      type: "INTENT_REJECTED",
      payload: toJson({ intent, reason }),
    },
  });
  return { accepted: false, intent, reason };
}

interface StoredAcceptedPayload {
  intent: StructuredIntent;
  scene: StructuredSceneOutput;
  sceneFailureReason: SceneFailureReason | null;
  relationshipChanges:
    | Array<{ dimension: RelationshipDimensionKey; previousValue: number; newValue: number }>
    | null;
}

/**
 * Looks up a prior INTENT_RESOLVED StoryEvent carrying this idempotency
 * key, scoped to this session. Reconstructs the same result shape
 * submitPlayerInput would have returned the first time, so a retried
 * call is a safe no-op read, never a second write.
 */
async function findResultByIdempotencyKey(
  storySessionId: string,
  universeId: string,
  idempotencyKey: string
): Promise<SubmitPlayerInputResult | null> {
  const event = await prisma.storyEvent.findFirst({
    where: {
      storySessionId,
      type: "INTENT_RESOLVED",
      payload: { path: ["idempotencyKey"], equals: idempotencyKey },
    },
  });
  if (!event) return null;

  const payload = event.payload as unknown as StoredAcceptedPayload;
  return {
    accepted: true,
    intent: payload.intent,
    storyEventId: event.id,
    universeId,
    scene: payload.scene,
    sceneFailureReason: payload.sceneFailureReason,
    beatAdvancedTo: null,
    beatAdvancedToName: null,
    sessionCompleted: false,
    relationshipChanges: payload.relationshipChanges,
  };
}

/**
 * The main pipeline entry point: USER INPUT -> INTENT PARSER -> VALIDATION
 * -> STATE TRANSITION -> MEMORY EXTRACTION -> STATE COMMIT. Everything
 * that mutates state runs inside one prisma.$transaction, so a failure
 * partway through (e.g. an unexpected error writing the audit event)
 * rolls back every write from this call - no partial commit of a
 * relationship change without its causing StoryEvent, or vice versa.
 */
export async function submitPlayerInput(
  params: SubmitPlayerInputParams
): Promise<SubmitPlayerInputResult> {
  const session = await loadSessionForPlayer(
    params.playerId,
    params.storySessionId
  );
  if (!session) {
    throw new RomanceStoryNotFoundError();
  }

  if (params.idempotencyKey) {
    const replayed = await findResultByIdempotencyKey(
      session.id,
      session.universeId,
      params.idempotencyKey
    );
    if (replayed) return replayed;
  }

  const intent = parseFreeformIntent(params.rawInput);
  const beatId = session.currentBeatId;

  // Reject likely age/intimacy combinations before any scene-generation API
  // receives derived content. The deterministic parser runs locally only.
  if (
    typeof params.rawInput === "string" &&
    containsSuspectedChildSexualText(params.rawInput)
  ) {
    return recordRejection(
      session.id,
      params.playerId,
      beatId,
      intent,
      "safety:potential_age_intimacy"
    );
  }

  if (intent.type === "UNPARSEABLE") {
    return recordRejection(
      session.id,
      params.playerId,
      beatId,
      intent,
      `unparseable:${intent.unparseableReason}`
    );
  }

  const availableActions = session.currentBeat?.availableActions ?? [];
  if (!availableActions.includes(intent.type)) {
    return recordRejection(
      session.id,
      params.playerId,
      beatId,
      intent,
      "not_allowed_in_current_beat"
    );
  }

  if (intent.type === "PROPOSE_BARGAIN" && !params.bargainBreachConsequence) {
    return recordRejection(
      session.id,
      params.playerId,
      beatId,
      intent,
      "bargain_requires_breach_consequence"
    );
  }

  const needsTarget = [
    "PROMISE",
    "REVEAL_TRUE_NAME",
    "PROPOSE_BARGAIN",
    "ACCEPT_BARGAIN",
    "BREAK_BARGAIN",
  ].includes(intent.type);
  if (needsTarget && !params.targetCharacterSlug) {
    return recordRejection(
      session.id,
      params.playerId,
      beatId,
      intent,
      "missing_target_character"
    );
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const storyEventPayload: Record<string, unknown> = { intent };
      if (params.idempotencyKey) {
        storyEventPayload.idempotencyKey = params.idempotencyKey;
      }

      switch (intent.type) {
        case "PROMISE": {
          const promise = await tx.promise.create({
            data: {
              storySessionId: session.id,
              playerId: params.playerId,
              characterSlug: params.targetCharacterSlug!,
              madeBy: "player",
              content: intent.content,
            },
          });
          await writeMemory(tx, {
            storySessionId: session.id,
            playerId: params.playerId,
            type: "PROMISE",
            subject: "player",
            object: params.targetCharacterSlug!,
            content: intent.content,
            source: "USER_STATED",
            relatedCharacterSlug: params.targetCharacterSlug,
          });
          storyEventPayload.promiseId = promise.id;
          break;
        }

        case "REVEAL_TRUE_NAME": {
          await tx.canonFact.create({
            data: {
              storySessionId: session.id,
              playerId: params.playerId,
              factType: "CHARACTER_KNOWLEDGE",
              subject: params.targetCharacterSlug!,
              content: `player revealed true name: ${intent.revealedName}`,
            },
          });
          await writeMemory(tx, {
            storySessionId: session.id,
            playerId: params.playerId,
            type: "USER_FACT",
            subject: params.targetCharacterSlug!,
            object: null,
            content: `knows player's true name: ${intent.revealedName}`,
            source: "USER_STATED",
            relatedCharacterSlug: params.targetCharacterSlug,
          });
          const changes = await applyRelationshipDeltaAtomic(
            tx,
            session.id,
            params.playerId,
            params.targetCharacterSlug!,
            "TRUE_NAME_REVEALED"
          );
          storyEventPayload.relationshipChanges = changes;
          break;
        }

        case "PROPOSE_BARGAIN": {
          const bargain = await tx.bargain.create({
            data: {
              storySessionId: session.id,
              playerId: params.playerId,
              characterSlug: params.targetCharacterSlug!,
              terms: intent.content,
              breachConsequence: params.bargainBreachConsequence!,
              proposerConfirmed: true,
            },
          });
          storyEventPayload.bargainId = bargain.id;
          break;
        }

        case "ACCEPT_BARGAIN": {
          const proposed = await tx.bargain.findFirst({
            where: {
              storySessionId: session.id,
              characterSlug: params.targetCharacterSlug!,
              status: "PROPOSED",
            },
            orderBy: { createdAt: "desc" },
          });
          if (!proposed || !canTransitionBargain("PROPOSED", "SEALED")) {
            throw new RomanceValidationError("no_proposed_bargain_to_accept");
          }
          const updated = await tx.bargain.updateMany({
            where: { id: proposed.id, status: "PROPOSED" },
            data: {
              status: "SEALED",
              counterpartyConfirmed: true,
              sealedAt: new Date(),
            },
          });
          if (updated.count === 0) {
            throw new RomanceValidationError(
              "bargain_state_changed_concurrently"
            );
          }
          const changes = await applyRelationshipDeltaAtomic(
            tx,
            session.id,
            params.playerId,
            params.targetCharacterSlug!,
            "BARGAIN_SEALED"
          );
          storyEventPayload.bargainId = proposed.id;
          storyEventPayload.relationshipChanges = changes;
          break;
        }

        case "BREAK_BARGAIN": {
          const sealed = await tx.bargain.findFirst({
            where: {
              storySessionId: session.id,
              characterSlug: params.targetCharacterSlug!,
              status: "SEALED",
            },
            orderBy: { sealedAt: "desc" },
          });
          if (!sealed || !canTransitionBargain("SEALED", "BROKEN")) {
            throw new RomanceValidationError("no_sealed_bargain_to_break");
          }
          const updated = await tx.bargain.updateMany({
            where: { id: sealed.id, status: "SEALED" },
            data: { status: "BROKEN", resolvedAt: new Date() },
          });
          if (updated.count === 0) {
            throw new RomanceValidationError(
              "bargain_state_changed_concurrently"
            );
          }
          const changes = await applyRelationshipDeltaAtomic(
            tx,
            session.id,
            params.playerId,
            params.targetCharacterSlug!,
            "BARGAIN_BROKEN"
          );
          await writeMemory(tx, {
            storySessionId: session.id,
            playerId: params.playerId,
            type: "BETRAYAL",
            subject: "player",
            object: params.targetCharacterSlug!,
            content: `broke the sealed bargain: ${sealed.terms}`,
            source: "SYSTEM_INFERRED",
            relatedCharacterSlug: params.targetCharacterSlug,
          });
          storyEventPayload.bargainId = sealed.id;
          storyEventPayload.breachConsequence = sealed.breachConsequence;
          storyEventPayload.relationshipChanges = changes;
          break;
        }

        case "ASK_QUESTION":
        case "GENERIC_ACTION":
          // No deterministic state effect of their own - the scene
          // generation step below is their only effect beyond the audit
          // trail, via the bounded relationship nudge and memory
          // candidates it may propose.
          break;
      }

      const targetCharacterSlug = params.targetCharacterSlug ?? null;
      const beatSlug = session.currentBeat?.slug ?? "unknown";
      const beatName = session.currentBeat?.name ?? "Unknown";

      const [canonContext, sceneContext, safetyContext] = await Promise.all([
        buildCanonContext(tx, session.id, session.universeId),
        buildSceneGenerationContext(
          tx,
          session,
          beatSlug,
          beatName,
          intent,
          targetCharacterSlug
        ),
        buildSceneSafetyContext(tx, session.universeId, params.playerId),
      ]);

      const sceneResult = await generateValidatedScene(
        params.llmProvider ?? getSceneProvider(),
        sceneContext,
        canonContext,
        safetyContext,
        params.sceneSafetyClassifier ?? getSceneSafetyClassifier()
      );

      if (sceneResult.failureReason) {
        await tx.storyEvent.create({
          data: {
            storySessionId: session.id,
            playerId: params.playerId,
            beatId,
            type: "CANON_VALIDATION_FAILED",
            payload: toJson({
              intentType: intent.type,
              attempts: sceneResult.attempts,
              failureReason: sceneResult.failureReason,
              violations: sceneResult.violationsEncountered,
              qualityIssues: sceneResult.qualityIssuesEncountered,
              safetyViolations: sceneResult.safetyViolationsEncountered,
            }),
          },
        });
      }

      // Only ASK_QUESTION/GENERIC_ACTION apply the scene's proposed
      // nudge - every other intent type already applied its own
      // deterministic relationship delta above, and applying both would
      // double-count the same action.
      if (
        (intent.type === "ASK_QUESTION" || intent.type === "GENERIC_ACTION") &&
        sceneResult.scene.proposedRelationshipNudge &&
        targetCharacterSlug
      ) {
        const nudge = sceneResult.scene.proposedRelationshipNudge;
        const changes = await applyRelationshipDeltaAtomic(
          tx,
          session.id,
          params.playerId,
          nudge.characterSlug,
          nudge.cause
        );
        storyEventPayload.relationshipChanges = changes;
      }

      const validMemoryCandidates = selectValidSceneMemoryCandidates(
        sceneResult.scene.proposedMemoryCandidates
      );
      for (const candidate of validMemoryCandidates) {
        await writeMemory(tx, {
          storySessionId: session.id,
          playerId: params.playerId,
          type: candidate.type,
          subject: candidate.subject,
          object: candidate.object,
          content: candidate.content,
          source: "SYSTEM_INFERRED",
          relatedCharacterSlug: targetCharacterSlug,
        });
      }

      storyEventPayload.scene = sceneResult.scene;
      storyEventPayload.sceneFailureReason = sceneResult.failureReason;
      storyEventPayload.sceneAttempts = sceneResult.attempts;

      const storyEvent = await tx.storyEvent.create({
        data: {
          storySessionId: session.id,
          playerId: params.playerId,
          beatId,
          type: "INTENT_RESOLVED",
          payload: toJson(storyEventPayload),
        },
      });

      // Beat Graph auto-advance (Story Engine Bible §7): check the
      // current beat's declared exitConditions against what just
      // happened. exitConditions defaults to {} (not an array) on beats
      // that declare none - never trust stored Json shape blindly.
      let beatAdvancedTo: string | null = null;
      let beatAdvancedToName: string | null = null;
      let sessionCompleted = false;

      const exitRules = Array.isArray(session.currentBeat?.exitConditions)
        ? (session.currentBeat.exitConditions as unknown as BeatExitRule[])
        : [];

      if (exitRules.length > 0 && session.currentBeat) {
        const effectiveEventType = deriveBeatTransitionEventType(intent.type);
        const occurrencesInBeat =
          effectiveEventType === "INTENT_RESOLVED"
            ? await tx.storyEvent.count({
                where: { storySessionId: session.id, beatId, type: "INTENT_RESOLVED" },
              })
            : 1;

        const transition = evaluateBeatTransition(
          exitRules,
          effectiveEventType,
          occurrencesInBeat
        );

        if (transition?.completesSession) {
          sessionCompleted = true;
          await tx.storySession.update({
            where: { id: session.id },
            data: { status: "COMPLETED", completedAt: new Date() },
          });
        } else if (transition?.next) {
          const nextBeat = await tx.beat.findFirst({
            where: { seasonId: session.seasonId, slug: transition.next },
            orderBy: { version: "desc" },
          });
          if (nextBeat) {
            beatAdvancedTo = nextBeat.slug;
            beatAdvancedToName = nextBeat.name;
            await tx.storyEvent.create({
              data: {
                storySessionId: session.id,
                playerId: params.playerId,
                beatId: session.currentBeat.id,
                type: "BEAT_EXITED",
                payload: toJson({ beatSlug: session.currentBeat.slug }),
              },
            });
            await tx.storyEvent.create({
              data: {
                storySessionId: session.id,
                playerId: params.playerId,
                beatId: nextBeat.id,
                type: "BEAT_ENTERED",
                payload: toJson({ beatSlug: nextBeat.slug }),
              },
            });
            await tx.storySession.update({
              where: { id: session.id },
              data: { currentBeatId: nextBeat.id },
            });
          }
        }
      }

      await tx.storySession.update({
        where: { id: session.id },
        data: { lastPlayedAt: new Date() },
      });

      return {
        accepted: true,
        intent,
        storyEventId: storyEvent.id,
        universeId: session.universeId,
        scene: sceneResult.scene,
        sceneFailureReason: sceneResult.failureReason,
        beatAdvancedTo,
        beatAdvancedToName,
        sessionCompleted,
        relationshipChanges:
          (storyEventPayload.relationshipChanges as Array<{
            dimension: RelationshipDimensionKey;
            previousValue: number;
            newValue: number;
          }>) ?? null,
      };
    }, { maxWait: 5000, timeout: 30000 });
  } catch (error) {
    if (error instanceof RomanceValidationError) {
      return recordRejection(
        session.id,
        params.playerId,
        beatId,
        intent,
        error.reason
      );
    }
    throw error;
  }
}

/**
 * Scoped memory retrieval - always filtered (by session + optional
 * type/character), never "give the model everything" (Story Engine
 * Bible §5.7). This is the read side of the "memory proof" golden
 * scenario: a promise made in one call must still be retrievable many
 * events later.
 */
export async function getMemoriesForContext(
  playerId: string,
  storySessionId: string,
  options: { type?: string; relatedCharacterSlug?: string } = {}
) {
  return prisma.romanceMemory.findMany({
    where: {
      storySessionId,
      playerId,
      status: "ACTIVE",
      ...(options.type && { type: options.type as never }),
      ...(options.relatedCharacterSlug && {
        relatedCharacterSlug: options.relatedCharacterSlug,
      }),
    },
    orderBy: { createdAt: "asc" },
  });
}
