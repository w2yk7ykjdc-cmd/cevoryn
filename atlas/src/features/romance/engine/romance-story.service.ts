import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { canTransitionBargain } from "./commitment-fsm-math";
import { parseFreeformIntent } from "./intent-parser-math";
import { resolveMemoryWrite } from "./memory-dedup-math";
import { getRelationshipDelta } from "./relationship-transition-math";
import type {
  MemoryLite,
  RelationshipDimensionKey,
  RelationshipEventCause,
  StructuredIntent,
} from "./types";

/**
 * Romance Story Engine orchestration - the server-only wrapper around the
 * pure deterministic layer (intent-parser-math, canon-validator-math,
 * relationship-transition-math, commitment-fsm-math, memory-dedup-math).
 * See docs/romance/02-STORY_ENGINE_BIBLE.md §7 for the pipeline this
 * implements: USER INPUT -> INTENT PARSER -> VALIDATION -> STATE
 * TRANSITION -> MEMORY EXTRACTION -> STATE COMMIT.
 *
 * NOT implemented in this slice (see final report's known-gaps section):
 * LLM scene generation (step "SCENE PLAN -> LLM SCENE GENERATION" is a
 * real AIProvider call site that exists in the full pipeline design but
 * is not wired or tested here - this sandbox has no real OPENAI_API_KEY,
 * and claiming it "works" without exercising it against a real provider
 * would violate the explicit "never report a failure state as success"
 * instruction), and the post-generation canon-validation-of-prose step
 * (which depends on scene generation existing first). What IS real and
 * tested here is everything upstream and downstream of that gap: intent
 * parsing, beat-gated validation, state transitions, memory writes, and
 * the canon validator as a standalone, structurally-enforced unit.
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
}

export type SubmitPlayerInputResult =
  | { accepted: true; intent: StructuredIntent; storyEventId: string }
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

  const intent = parseFreeformIntent(params.rawInput);
  const beatId = session.currentBeatId;

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
          // No deterministic state effect beyond the audit trail - in the
          // full pipeline this is where scene generation would be invoked
          // (not implemented in this slice; see module-level comment).
          break;
      }

      const storyEvent = await tx.storyEvent.create({
        data: {
          storySessionId: session.id,
          playerId: params.playerId,
          beatId,
          type: "INTENT_RESOLVED",
          payload: toJson(storyEventPayload),
        },
      });

      await tx.storySession.update({
        where: { id: session.id },
        data: { lastPlayedAt: new Date() },
      });

      return { accepted: true, intent, storyEventId: storyEvent.id };
    });
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
