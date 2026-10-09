/**
 * generate -> validate -> repair -> regenerate -> fallback pipeline.
 * Orchestrates canon validation, narrative-quality validation, and the
 * injectable structured safety policy against untrusted provider output. No Prisma, no
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

function safeFallbackScene(): StructuredSceneOutput {
  return {
    narration: "The story pauses while the next moment is prepared.",
    dialogueLines: [],
    sceneClaims: [],
    proposedRelationshipNudge: null,
    proposedMemoryCandidates: [],
  };
}

/**
 * Runs the full pipeline. Generated scenes must pass canon, narrative-quality,
 * and safety validation. The deterministic fallback is checked through the
 * same deterministic gates before it can be returned.
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
      (violationsEncountered.length > 0 ||
        qualityIssuesEncountered.length > 0 ||
        safetyViolationsEncountered.length > 0)
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

    let canonResult = { valid: false, violations: [] as CanonViolation[] };
    let qualityIssues: NarrativeQualityIssue[] = [];
    let safetyViolations: SceneSafetyViolation[] = [];
    let malformedScene = false;

    try {
      canonResult = validateSceneClaims(scene.sceneClaims, canonContext);
      qualityIssues = evaluateNarrativeQuality(scene);
    } catch {
      // A malformed provider object is untrusted input too. Do not pass it to
      // the remote classifier or return it to the player.
      malformedScene = true;
      safetyViolations = [{
        ruleId: "SAFETY-013",
        message: "Generated scene structure is malformed; refusing to show it.",
      }];
    }

    if (!malformedScene && containsSuspectedChildSexualContent(scene)) {
      // Potential age/intimacy combinations are rejected locally before the
      // scene is sent to any remote classifier. This is defense-in-depth,
      // not the primary classifier.
      safetyViolations = [{
        ruleId: "SAFETY-011",
        message: "Potentially unsafe age/intimacy combination detected before remote classification.",
      }];
    } else if (!malformedScene) {
      try {
        const safetyResult = validateSceneSafety(
          scene,
          await safetyClassifier.classify(scene, safetyContext),
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

  const fallback = safeFallbackScene();
  const fallbackCanon = validateSceneClaims(fallback.sceneClaims, canonContext);
  const fallbackQuality = evaluateNarrativeQuality(fallback);
  const fallbackSafety = validateSceneSafety(
    fallback,
    {
      sexualContentDetected: false,
      involvedCharacterSlugs: [],
      ageRisk: "NONE",
      relationshipRisk: "NONE",
      consentRisk: "CLEAR",
    },
    safetyContext
  );
  if (
    !fallbackCanon.valid ||
    fallbackQuality.length > 0 ||
    !fallbackSafety.valid
  ) {
    // A regression in the authored fallback is an engine error, never a
    // reason to return content that failed one of the mandatory gates.
    throw new Error("The built-in safe fallback failed deterministic validation.");
  }

  return {
    scene: fallback,
    valid: true,
    attempts: MAX_ATTEMPTS + 1,
    failureReason: "fallback",
    violationsEncountered,
    qualityIssuesEncountered,
    safetyViolationsEncountered,
  };
}
