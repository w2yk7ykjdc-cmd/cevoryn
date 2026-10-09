/**
 * Canon Validator - pure, structural checks. No Prisma, no AI, no
 * "server-only". See docs/romance/02-STORY_ENGINE_BIBLE.md §6
 * (CANON-001..007). This is the brief's own worked example made real:
 * "if the player never gave Caelan their true name, a scene where
 * 'Caelan knows your true name' must be INVALID."
 *
 * This function validates a list of structured SceneClaims (facts a
 * generated scene asserts) against the session's actual CanonContext. It
 * knows nothing about how claims are extracted from LLM output or scene
 * text - that extraction step is a separate, not-yet-built concern (see
 * final report's known-gaps section). What this function guarantees is
 * that a true claim set can only be validated against what the ledger
 * actually recorded, never against what a scene merely asserts about
 * itself.
 */

import type {
  CanonContext,
  CanonValidationResult,
  CanonViolation,
  SceneClaim,
} from "./types";

function validateClaim(
  claim: SceneClaim,
  context: CanonContext
): CanonViolation | null {
  switch (claim.type) {
    case "CHARACTER_KNOWS_TRUE_NAME": {
      if (!context.trueNameRevealedTo.has(claim.characterSlug)) {
        return {
          ruleId: "CANON-001",
          message: `${claim.characterSlug} is claimed to know the player's true name, but no CanonFact records the player ever revealing it.`,
          claim,
        };
      }
      return null;
    }
    case "CHARACTER_CLAIMS_BARGAIN_FULFILLED_WITHOUT_CONSEQUENCE": {
      if (!claim.referenceId || !context.knownBargainIds.has(claim.referenceId)) {
        return {
          ruleId: "CANON-004",
          message: `${claim.characterSlug} references a bargain (${claim.referenceId ?? "unknown"}) that was never actually proposed or sealed in this session.`,
          claim,
        };
      }
      return null;
    }
    case "CHARACTER_REFERENCES_UNMADE_PROMISE": {
      if (!claim.referenceId || !context.knownPromiseIds.has(claim.referenceId)) {
        return {
          ruleId: "CANON-005",
          message: `${claim.characterSlug} references a promise (${claim.referenceId ?? "unknown"}) that was never actually made in this session.`,
          claim,
        };
      }
      return null;
    }
    case "CHARACTER_INVOLVED_IN_SEXUAL_CONTENT": {
      if (!context.adultCharacterSlugs.has(claim.characterSlug)) {
        return {
          ruleId: "CANON-006",
          message: `${claim.characterSlug} is involved in sexual content but is not on record as an adult character - this scene can never pass regardless of retries.`,
          claim,
        };
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * Validates every claim a candidate scene makes against the session's
 * canon context. A scene with any violation must never be shown to the
 * player (brief §10: regenerate -> repair -> fallback, never display).
 */
export function validateSceneClaims(
  claims: SceneClaim[],
  context: CanonContext
): CanonValidationResult {
  const violations = claims
    .map((claim) => validateClaim(claim, context))
    .filter((v): v is CanonViolation => v !== null);

  return { valid: violations.length === 0, violations };
}
