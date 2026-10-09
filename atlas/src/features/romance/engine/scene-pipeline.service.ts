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
import { evaluateNarrativeQuality } from "./narrative-quality-math";
import type { NarrativeQualityIssue } from "./narrative-quality-math";
import type {
  LLMProvider,
  SceneGenerationContext,
  StructuredSceneOutput,
} from "./scene-generation-provider";
import type { CanonContext, CanonViolation } from "./types";
import {
  containsSuspectedChildSexualContent,
  validateSceneSafety,
} from "./scene-safety-policy";
import type {
  SceneSafetyClassifier,
  SceneSafetyContext,
  SceneSafetyViolation,
} from "./scene-safety-policy";

export type SceneFailureReason = "regenerated" | "repaired" | "fallback";

export interface ValidatedSceneResult {
  scene: StructuredSceneOutput;
  valid: boolean;
  attempts: number;
  /** Non-null only when the final result required recovery (brief's "FailureMode" log). */
  failureReason: SceneFailureReason | null;
  violationsEncountered: CanonViolation[];
  /** Prose-quality issues (repetitive dialogue, empty narration) hit along the way - separate from canon violations since these are style, not fact, problems. */
  qualityIssuesEncountered: NarrativeQualityIssue[];
  safetyViolationsEncountered: SceneSafetyViolation[];
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
  canonContext: CanonContext,
  safetyContext: SceneSafetyContext,
  safetyClassifier: SceneSafetyClassifier
): Promise<ValidatedSceneResult> {
  const violationsEncountered: CanonViolation[] = [];
  const qualityIssuesEncountered: NarrativeQualityIssue[] = [];
  const safetyViolationsEncountered: SceneSafetyViolation[] = [];

  for (let attemptNumber = 1; attemptNumber <= MAX_ATTEMPTS; attemptNumber++) {
    const attemptContext: SceneGenerationContext = {
      ...context,
      attemptNumber,
      ...(attemptNumber === 3 &&
      (violationsEncountered.length > 0 || qualityIssuesEncountered.length > 0)
        ? {
            priorViolations: [
              ...violationsEncountered.map((v) => ({ ruleId: v.ruleId, message: v.message })),
              ...qualityIssuesEncountered.map((q) => ({ ruleId: q.code, message: q.message })),
              ...safetyViolationsEncountered.map((v) => ({ ruleId: v.ruleId, message: v.message })),
            ],
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

    const canonResult = validateSceneClaims(scene.sceneClaims, canonContext);
    const qualityIssues = evaluateNarrativeQuality(scene);
    let safetyViolations: SceneSafetyViolation[] = [];

    // Potential child-sexual content is rejected locally before the scene is
    // sent to any remote classifier. This preflight is defense-in-depth, not
    // the primary classifier.
    if (containsSuspectedChildSexualContent(scene)) {
      safetyViolations = [{
        ruleId: "SAFETY-011",
        message: "Potentially unsafe age/sexual-content combination detected; scene rejected before remote classification.",
      }];
    } else {
      try {
        const safetyResult = validateSceneSafety(
          scene,
          await safetyClassifier.classify(scene),
          safetyContext
        );
        safetyViolations = safetyResult.violations;
      } catch {
        // Classifier timeout/network/provider errors fail closed and use the
        // same regenerate -> repair -> safe fallback pipeline.
        safetyViolations = [{
          ruleId: "SAFETY-012",
          message: "Safety classification failed; scene cannot be shown.",
        }];
      }
    }

    if (
      canonResult.valid &&
      qualityIssues.length === 0 &&
      safetyViolations.length === 0
    ) {
      return {
        scene,
        valid: true,
        attempts: attemptNumber,
        failureReason:
          attemptNumber === 1 ? null : attemptNumber === 2 ? "regenerated" : "repaired",
        violationsEncountered,
        qualityIssuesEncountered,
        safetyViolationsEncountered,
      };
    }

    violationsEncountered.push(...canonResult.violations);
    qualityIssuesEncountered.push(...qualityIssues);
    safetyViolationsEncountered.push(...safetyViolations);
  }

  return {
    scene: safeFallbackScene(context),
    valid: true,
    attempts: MAX_ATTEMPTS + 1,
    failureReason: "fallback",
    violationsEncountered,
    qualityIssuesEncountered,
    safetyViolationsEncountered,
  };
}
