import type {
  RelationshipDimensions,
  RelationshipEventCause,
  SceneClaim,
  StructuredIntent,
} from "./types";

/**
 * Scene-generation provider abstraction. Distinct from the generic
 * chat-oriented AIProvider (src/features/ai/providers) because Romance
 * needs STRUCTURED output the Story Engine can validate, not raw prose.
 * No Prisma, no "server-only" here on purpose - this file holds only the
 * interface/types and the deterministic TestSceneProvider, so it's
 * directly unit-testable. The real OpenAI-backed implementation (which
 * does need "server-only", since it imports the AIProvider factory) lives
 * in ./openai-scene-provider.ts.
 *
 * The LLM never becomes the source of truth: everything it returns here
 * is a *proposal* - sceneClaims are checked by canon-validator-math
 * before the scene is ever shown, the relationship nudge (for
 * GENERIC_ACTION/ASK_QUESTION only) picks a direction but the Story
 * Engine owns the fixed magnitude, and memoryCandidates are filtered by
 * scene-memory-candidate-math before anything is persisted.
 */

export interface DialogueLine {
  speakerSlug: string;
  text: string;
}

export interface ProposedRelationshipNudge {
  characterSlug: string;
  cause: Extract<
    RelationshipEventCause,
    "NARRATIVE_POSITIVE_BEAT" | "NARRATIVE_NEGATIVE_BEAT"
  >;
}

export interface StructuredSceneOutput {
  narration: string;
  dialogueLines: DialogueLine[];
  sceneClaims: SceneClaim[];
  proposedRelationshipNudge: ProposedRelationshipNudge | null;
  proposedMemoryCandidates: unknown[];
}

export interface CharacterVoiceContext {
  speechStyle: string;
  personalityTraits: string[];
  goals: string[];
  fears: string[];
  values: string[];
}

export interface SceneGenerationContext {
  beatSlug: string;
  beatName: string;
  intent: StructuredIntent;
  targetCharacterSlug: string | null;
  relevantMemories: Array<{
    type: string;
    subject: string;
    object: string | null;
    content: string;
  }>;
  relevantCanonFacts: Array<{ factType: string; subject: string; content: string }>;
  relationshipState: RelationshipDimensions | null;
  /** Character record trimmed to what this scene is allowed to use - never the full content row. */
  characterKnowledgeScope: string | null;
  /** How this specific character sounds and what drives them - without this, every character's dialogue reads generic/interchangeable. */
  characterVoice: CharacterVoiceContext | null;
  /** 1 on the first attempt; >1 on a regenerate/repair re-prompt after a canon-validation failure (see scene-pipeline.service.ts). */
  attemptNumber?: number;
  /** Set only on a "repair" attempt (attemptNumber 3): exactly which rules the prior attempt violated, so a real provider can correct for them. */
  priorViolations?: Array<{ ruleId: string; message: string }>;
}

export class SceneGenerationError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "SceneGenerationError";
  }
}

export interface LLMProvider {
  readonly name: string;
  generateScene(context: SceneGenerationContext): Promise<StructuredSceneOutput>;
}

/**
 * Shared system prompt - exported so the real provider (which does the
 * actual network call) doesn't duplicate it.
 */
export const SCENE_SYSTEM_PROMPT = `You are the Scene Generation step of a deterministic Story Engine for an \
18+ interactive romance fiction product. You do NOT control canon, relationships, or world \
state - you only narrate within constraints the engine gives you.

Respond with ONLY a JSON object matching this exact shape:
{
  "narration": string,
  "dialogueLines": [{ "speakerSlug": string, "text": string }],
  "sceneClaims": [{ "type": "CHARACTER_KNOWS_TRUE_NAME" | "CHARACTER_CLAIMS_BARGAIN_FULFILLED_WITHOUT_CONSEQUENCE" | "CHARACTER_REFERENCES_UNMADE_PROMISE" | "CHARACTER_INVOLVED_IN_SEXUAL_CONTENT", "characterSlug": string, "referenceId"?: string }],
  "proposedRelationshipNudge": null | { "characterSlug": string, "cause": "NARRATIVE_POSITIVE_BEAT" | "NARRATIVE_NEGATIVE_BEAT" },
  "proposedMemoryCandidates": [{ "type": string, "subject": string, "object": string | null, "content": string }]
}

Rules you must never violate:
- A character may only be shown knowing the player's true name if told explicitly in the \
provided context that it was revealed to them - otherwise never emit a CHARACTER_KNOWS_TRUE_NAME claim for them.
- Never have a character reference a bargain or promise that is not listed in the provided context.
- Never invent sexual content involving a character whose age is not explicitly established as an adult.
- Never force romantic or intimate progression the player's input did not invite.
- Whenever a scene depicts sexual or intimate physical content involving a character, you MUST \
emit a CHARACTER_INVOLVED_IN_SEXUAL_CONTENT claim for that character, every time, with no \
exceptions - this is the one claim type checked against the engine's own adult-character record, \
not your judgment, and a scene that omits it when it should be present is itself a violation.

Craft rules - this is premium interactive fiction, not a chatbot. The narrative-quality gate below checks repetition and empty narration; other craft and safety rules in this prompt are guidance, not structural enforcement. Do not claim that a rule is automatically enforced unless a dedicated validator implements it:
- Narration and dialogue must never say the same thing twice in different words. Narration \
covers action, setting, and sensory detail; dialogue reveals character through word choice \
and subtext. If the narration already conveys a feeling or fact, the dialogue must not restate \
it - it must do new work (reveal information, make a choice, push back, deflect).
- Dramatize, don't explain. Never write a sentence that names an emotion directly ("he felt \
afraid," "the tension was palpable") - show it through a concrete action, a physical detail, or \
what a character does or doesn't say.
- When "characterVoice" is provided for the character being addressed, every line of their \
dialogue must sound like THEM specifically: match their speechStyle literally (if it says they \
rarely contract words, never contract their words), and let their goals/fears/values shape what \
they choose to say or withhold. Two different characters in this universe must never sound \
interchangeable.
- Every scene must do real work: advance the plot, reveal new information, shift the \
relationship, or introduce a genuine complication. Never a scene that only restates the status \
quo the player already knows.
- Be concise. Favor a handful of sentences with real weight over a paragraph that pads the same \
beat. Pacing is part of the craft here, not an afterthought.`;

export function buildSceneUserPrompt(context: SceneGenerationContext): string {
  return JSON.stringify({
    beat: { slug: context.beatSlug, name: context.beatName },
    playerIntent: { type: context.intent.type, content: context.intent.content },
    targetCharacterSlug: context.targetCharacterSlug,
    relevantMemories: context.relevantMemories,
    relevantCanonFacts: context.relevantCanonFacts,
    relationshipState: context.relationshipState,
    characterKnowledgeScope: context.characterKnowledgeScope,
    characterVoice: context.characterVoice,
    priorViolations: context.priorViolations ?? [],
  });
}

export function parseStructuredSceneOutput(raw: string): StructuredSceneOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new SceneGenerationError("Scene provider returned non-JSON output.", error);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new SceneGenerationError("Scene provider output was not a JSON object.");
  }

  const obj = parsed as Record<string, unknown>;
  if (typeof obj.narration !== "string") {
    throw new SceneGenerationError("Scene provider output missing 'narration'.");
  }

  return {
    narration: obj.narration,
    dialogueLines: Array.isArray(obj.dialogueLines) ? (obj.dialogueLines as DialogueLine[]) : [],
    sceneClaims: Array.isArray(obj.sceneClaims) ? (obj.sceneClaims as SceneClaim[]) : [],
    proposedRelationshipNudge:
      (obj.proposedRelationshipNudge as ProposedRelationshipNudge | null) ?? null,
    proposedMemoryCandidates: Array.isArray(obj.proposedMemoryCandidates)
      ? obj.proposedMemoryCandidates
      : [],
  };
}

/**
 * Deterministic test double - the brief's own required escape valve when
 * real LLM credentials are unavailable: "create the real provider
 * interface, create a deterministic test provider, test the full
 * pipeline with it." Defaults to a safe, generic, always-valid scene;
 * tests override `plan` to exercise specific (including deliberately
 * invalid) outputs.
 */
export class TestSceneProvider implements LLMProvider {
  readonly name = "test-scene-provider";

  constructor(
    private readonly plan?: (context: SceneGenerationContext) => StructuredSceneOutput
  ) {}

  async generateScene(context: SceneGenerationContext): Promise<StructuredSceneOutput> {
    if (this.plan) return this.plan(context);

    return {
      narration: `${context.targetCharacterSlug ?? "The room"} responds to your ${context.intent.type.toLowerCase().replace(/_/g, " ")}.`,
      dialogueLines: context.targetCharacterSlug
        ? [{ speakerSlug: context.targetCharacterSlug, text: "..." }]
        : [],
      sceneClaims: [],
      proposedRelationshipNudge:
        context.targetCharacterSlug &&
        (context.intent.type === "ASK_QUESTION" || context.intent.type === "GENERIC_ACTION")
          ? { characterSlug: context.targetCharacterSlug, cause: "NARRATIVE_POSITIVE_BEAT" }
          : null,
      proposedMemoryCandidates: [],
    };
  }
}
