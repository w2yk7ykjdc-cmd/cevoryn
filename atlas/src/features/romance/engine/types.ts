/**
 * Shared pure types for the Romance Story Engine's deterministic layer
 * (intent parsing, canon validation, state transitions, memory dedup).
 * No Prisma types here on purpose - these are the engine's own vocabulary,
 * independent of how a caller happens to load rows from the DB. See
 * docs/romance/02-STORY_ENGINE_BIBLE.md for the model this implements.
 */

export type StructuredIntentType =
  | "PROMISE"
  | "REVEAL_TRUE_NAME"
  | "PROPOSE_BARGAIN"
  | "ACCEPT_BARGAIN"
  | "BREAK_BARGAIN"
  | "ASK_QUESTION"
  | "GENERIC_ACTION"
  | "UNPARSEABLE";

export interface StructuredIntent {
  type: StructuredIntentType;
  /** Normalized free-text content relevant to the intent (promise text, question topic, etc). */
  content: string;
  /** Present only for REVEAL_TRUE_NAME. */
  revealedName?: string;
  /** Why the intent is UNPARSEABLE, if it is. */
  unparseableReason?: "empty" | "too_long" | "control_characters";
  /** Heuristic flags for defense-in-depth - never used as the sole safety control. */
  flags: {
    possiblePromptInjection: boolean;
  };
}

export interface RelationshipDimensions {
  trust: number;
  attraction: number;
  fear: number;
  loyalty: number;
  tension: number;
}

export type RelationshipDimensionKey = keyof RelationshipDimensions;

export type RelationshipEventCause =
  | "PROMISE_MADE"
  | "PROMISE_FULFILLED"
  | "PROMISE_BROKEN"
  | "BARGAIN_SEALED"
  | "BARGAIN_BROKEN"
  | "TRUE_NAME_REVEALED"
  /** A small, fixed-magnitude nudge the scene-generation step may propose
   * for GENERIC_ACTION/ASK_QUESTION scenes (which have no other
   * deterministic effect) - the LLM picks a direction, never a
   * magnitude, so it still never becomes the source of truth on *how
   * much* a relationship changes (brief: relationship changes remain
   * deterministic Story Engine operations). */
  | "NARRATIVE_POSITIVE_BEAT"
  | "NARRATIVE_NEGATIVE_BEAT";

export interface RelationshipChangeRecord {
  dimension: RelationshipDimensionKey;
  previousValue: number;
  newValue: number;
  delta: number;
  cause: RelationshipEventCause;
}

export type CanonFactTypeLite =
  | "WORLD_STATE"
  | "BARGAIN_TERM"
  | "PROMISE_TERM"
  | "DEBT_TERM"
  | "CHARACTER_KNOWLEDGE"
  | "REVEALED_SECRET";

/** The minimum a canon check needs to know about one character's claimed knowledge. */
export interface SceneClaim {
  type:
    | "CHARACTER_KNOWS_TRUE_NAME"
    | "CHARACTER_CLAIMS_BARGAIN_FULFILLED_WITHOUT_CONSEQUENCE"
    | "CHARACTER_REFERENCES_UNMADE_PROMISE"
    | "CHARACTER_INVOLVED_IN_SEXUAL_CONTENT";
  characterSlug: string;
  /** Present for CHARACTER_REFERENCES_UNMADE_PROMISE / bargain claims. */
  referenceId?: string;
}

export interface CanonContext {
  /** Character slugs the player's true name has actually been revealed to (from CanonFacts). */
  trueNameRevealedTo: Set<string>;
  /** Bargain ids currently SEALED or BROKEN (i.e., actually exist in this session). */
  knownBargainIds: Set<string>;
  /** Promise ids that actually exist (MADE or later) in this session. */
  knownPromiseIds: Set<string>;
  /** Character slugs on record (StoryCharacter.isAdult) as an adult - the only structural backstop against minor-sexualization; a scene must never emit CHARACTER_INVOLVED_IN_SEXUAL_CONTENT for anyone not in this set. */
  adultCharacterSlugs: Set<string>;
}

export interface CanonViolation {
  ruleId: string;
  message: string;
  claim: SceneClaim;
}

export interface CanonValidationResult {
  valid: boolean;
  violations: CanonViolation[];
}

export type FsmStatus = string;

export interface MemoryCandidate {
  type: string;
  subject: string;
  object: string | null;
  content: string;
}

export interface MemoryLite {
  id: string;
  type: string;
  subject: string;
  object: string | null;
  content: string;
  status: string;
}

export type MemoryWriteDecision =
  | { action: "CREATE" }
  | { action: "SKIP_DUPLICATE"; existingId: string }
  | { action: "SUPERSEDE"; supersedesId: string };
