/**
 * generate -> validate -> repair -> regenerate -> fallback pipeline.
 * Orchestrates (but does not itself implement) canon-validator-math's
 * validateSceneClaims() against an LLMProvider's output. No Prisma, no
 * "server-only" - it depends only on the LLMProvider interface (injected,
 * not imported concretely), so it's directly unit-testable with a
 * deterministic TestSceneProvider.
 *
 * Per Story Engine Bible §6: regenerate (same plan, new generation) ->
 * repair (re-prompt citing exactly which RULE_ID failed) -> fallback (a
 * safe, generic, pre-authored continuation). A scene that has not passed
 * validation is never returned to the caller - no exceptions.
 */
import { validateSceneClaims } from "./canon-validator-math";
import type {
  LLMProvider,
  SceneGenerationContext,
  StructuredSceneOutput,
} from "./scene-generation-provider";
import type { CanonContext, CanonViolation } from "./types";

export type SceneFailureReason = "regenerated" | "repaired" | "fallback";

export interface ValidatedSceneResult {
  scene: StructuredSceneOutput;
  valid: boolean;
  attempts: number;
  /** Non-null only when the final result required recovery (brief's "FailureMode" log). */
  failureReason: SceneFailureReason | null;
  violationsEncountered: CanonViolation[];
}

const MAX_ATTEMPTS = 3; // 1 = initial, 2 = regenerate (same plan), 3 = repair (cites prior violations); beyond this is the deterministic fallback.

function safeFallbackScene(context: SceneGenerationContext): StructuredSceneOutput {
  return {
    narration:
      "The moment holds, unresolved - as if the room itself is waiting " +
      "to see what you do next.",
    dialogueLines: context.targetCharacterSlug
      ? [{ speakerSlug: context.targetCharacterSlug, text: "..." }]
      : [],
    sceneClaims: [],
    proposedRelationshipNudge: null,
    proposedMemoryCandidates: [],
  };
}

/**
 * Runs the full pipeline. Always returns a scene that has actually
 * passed validateSceneClaims() - `valid` is true unless the caller is
 * looking at the guaranteed-valid deterministic fallback, in which case
 * it is also true (the fallback makes zero claims, so it trivially
 * passes). `violationsEncountered` lets the caller log what was rejected
 * even when the final result is clean.
 */
export async function generateValidatedScene(
  provider: LLMProvider,
  context: SceneGenerationContext,
  canonContext: CanonContext
): Promise<ValidatedSceneResult> {
  const violationsEncountered: CanonViolation[] = [];

  for (let attemptNumber = 1; attemptNumber <= MAX_ATTEMPTS; attemptNumber++) {
    const attemptContext: SceneGenerationContext = {
      ...context,
      attemptNumber,
      ...(attemptNumber === 3 && violationsEncountered.length > 0
        ? {
            priorViolations: violationsEncountered.map((v) => ({
              ruleId: v.ruleId,
              message: v.message,
            })),
          }
        : {}),
    };
    let scene: StructuredSceneOutput;
    try {
      scene = await provider.generateScene(attemptContext);
    } catch {
      // A provider timeout/network/format failure must not break the player's
      // session. Continue to the next recovery attempt; after MAX_ATTEMPTS
      // the deterministic fallback is returned and validated.
      continue;
    }

    const result = validateSceneClaims(scene.sceneClaims, canonContext);

    if (result.valid) {
      return {
        scene,
        valid: true,
        attempts: attemptNumber,
        failureReason:
          attemptNumber === 1 ? null : attemptNumber === 2 ? "regenerated" : "repaired",
        violationsEncountered,
      };
    }

    violationsEncountered.push(...result.violations);
  }

  return {
    scene: safeFallbackScene(context),
    valid: true,
    attempts: MAX_ATTEMPTS + 1,
    failureReason: "fallback",
    violationsEncountered,
  };
}
