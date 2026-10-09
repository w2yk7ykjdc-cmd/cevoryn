import type { StructuredSceneOutput } from "./scene-generation-provider";

export type SceneAgeRisk = "NONE" | "UNDERAGE_OR_AMBIGUOUS";
export type SceneRelationshipRisk = "NONE" | "FAMILY_OR_INCEST" | "UNKNOWN";
export type SceneConsentRisk = "CLEAR" | "COERCION_OR_NONCONSENT" | "AMBIGUOUS";

export interface SceneSafetyClassification {
  sexualContentDetected: boolean;
  involvedCharacterSlugs: string[];
  ageRisk: SceneAgeRisk;
  relationshipRisk: SceneRelationshipRisk;
  consentRisk: SceneConsentRisk;
}

export interface SceneSafetyCharacterEligibility {
  isAdult: boolean;
  relationshipToPlayerSafety: "UNRELATED" | "FAMILY_MEMBER" | "UNKNOWN";
}

export interface SceneSafetyContext {
  playerAdultVerified: boolean;
  characters: Record<string, SceneSafetyCharacterEligibility>;
}

export interface SceneSafetyClassifier {
  classify(scene: StructuredSceneOutput, context: SceneSafetyContext): Promise<unknown>;
}

export interface SceneSafetyViolation {
  ruleId: string;
  message: string;
}

export interface SceneSafetyValidationResult {
  valid: boolean;
  classification: SceneSafetyClassification | null;
  violations: SceneSafetyViolation[];
}

const AGE_RISKS = new Set<SceneAgeRisk>(["NONE", "UNDERAGE_OR_AMBIGUOUS"]);
const RELATIONSHIP_RISKS = new Set<SceneRelationshipRisk>([
  "NONE",
  "FAMILY_OR_INCEST",
  "UNKNOWN",
]);
const CONSENT_RISKS = new Set<SceneConsentRisk>([
  "CLEAR",
  "COERCION_OR_NONCONSENT",
  "AMBIGUOUS",
]);

export function parseSceneSafetyClassification(
  value: unknown
): SceneSafetyClassification | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.sexualContentDetected !== "boolean" ||
    !Array.isArray(candidate.involvedCharacterSlugs) ||
    !candidate.involvedCharacterSlugs.every((slug) => typeof slug === "string" && slug.length > 0) ||
    new Set(candidate.involvedCharacterSlugs).size !== candidate.involvedCharacterSlugs.length ||
    typeof candidate.ageRisk !== "string" ||
    !AGE_RISKS.has(candidate.ageRisk as SceneAgeRisk) ||
    typeof candidate.relationshipRisk !== "string" ||
    !RELATIONSHIP_RISKS.has(candidate.relationshipRisk as SceneRelationshipRisk) ||
    typeof candidate.consentRisk !== "string" ||
    !CONSENT_RISKS.has(candidate.consentRisk as SceneConsentRisk)
  ) {
    return null;
  }
  return {
    sexualContentDetected: candidate.sexualContentDetected,
    involvedCharacterSlugs: candidate.involvedCharacterSlugs as string[],
    ageRisk: candidate.ageRisk as SceneAgeRisk,
    relationshipRisk: candidate.relationshipRisk as SceneRelationshipRisk,
    consentRisk: candidate.consentRisk as SceneConsentRisk,
  };
}

/**
 * Defense-in-depth preflight. It is intentionally conservative and only
 * prevents potentially child-sexual content from being sent to any remote
 * classifier; it is not the scene safety classifier itself.
 */
export function containsSuspectedChildSexualText(text: string): boolean {
  const ageSignal =
    /\b(?:underage|minor|child|children|teen|teenage|schoolgirl|schoolboy|(?:1[0-7]|[0-9])[- ]year[- ]old)\b/i;
  const sexualSignal =
    /\b(?:sex|sexual|nude|naked|erotic|orgasm|genitals|intercourse|seduc(?:e|tion|tive))\b/i;
  return ageSignal.test(text) && sexualSignal.test(text);
}

export function containsSuspectedChildSexualContent(
  scene: StructuredSceneOutput
): boolean {
  const dialogue = Array.isArray(scene.dialogueLines)
    ? scene.dialogueLines
        .filter((line) => typeof line?.text === "string")
        .map((line) => line.text)
    : [];
  const text = [
    typeof scene.narration === "string" ? scene.narration : "",
    ...dialogue,
  ].join("\n");
  return containsSuspectedChildSexualText(text);
}

export function validateSceneSafety(
  scene: StructuredSceneOutput,
  rawClassification: unknown,
  context: SceneSafetyContext
): SceneSafetyValidationResult {
  const classification = parseSceneSafetyClassification(rawClassification);
  if (!classification) {
    return {
      valid: false,
      classification: null,
      violations: [{
        ruleId: "SAFETY-001",
        message: "Safety classifier output is malformed or incomplete; refusing to show the scene.",
      }],
    };
  }

  const violations: SceneSafetyViolation[] = [];
  const sexualClaims = scene.sceneClaims.filter(
    (claim) => claim?.type === "CHARACTER_INVOLVED_IN_SEXUAL_CONTENT"
  );
  const claimedSlugs = new Set(sexualClaims.map((claim) => claim.characterSlug));

  if (!classification.sexualContentDetected) {
    if (
      classification.involvedCharacterSlugs.length > 0 ||
      classification.ageRisk !== "NONE" ||
      classification.relationshipRisk !== "NONE" ||
      classification.consentRisk !== "CLEAR" ||
      sexualClaims.length > 0
    ) {
      violations.push({
        ruleId: "SAFETY-002",
        message: "Classifier result conflicts with the scene's sexual-content claims.",
      });
    }
    return { valid: violations.length === 0, classification, violations };
  }

  if (context.playerAdultVerified !== true) {
    violations.push({
      ruleId: "SAFETY-014",
      message: "The player account has no valid server-side 18+ verification.",
    });
  }
  if (classification.involvedCharacterSlugs.length === 0) {
    violations.push({
      ruleId: "SAFETY-003",
      message: "Sexual content was detected without identifying every involved character.",
    });
  }
  if (classification.ageRisk !== "NONE") {
    violations.push({
      ruleId: "SAFETY-004",
      message: "Underage or ambiguous age eligibility is not permitted in sexual content.",
    });
  }
  if (classification.relationshipRisk !== "NONE") {
    violations.push({
      ruleId: "SAFETY-005",
      message: "Family, incest, or unknown relationship safety is not permitted in sexual content.",
    });
  }
  if (classification.consentRisk !== "CLEAR") {
    violations.push({
      ruleId: "SAFETY-006",
      message: "Coercion, non-consent, or ambiguous consent is not permitted in sexual content.",
    });
  }

  for (const slug of classification.involvedCharacterSlugs) {
    const eligibility = context.characters[slug];
    if (!eligibility || eligibility.isAdult !== true) {
      violations.push({
        ruleId: "SAFETY-007",
        message: `Character "${slug}" is missing verified adult eligibility.`,
      });
    } else if (eligibility.relationshipToPlayerSafety !== "UNRELATED") {
      violations.push({
        ruleId: "SAFETY-008",
        message: `Character "${slug}" has family or unknown relationship eligibility.`,
      });
    }
    if (!claimedSlugs.has(slug)) {
      violations.push({
        ruleId: "SAFETY-009",
        message: `Sexual content involving "${slug}" is missing its required canon claim.`,
      });
    }
  }

  for (const slug of claimedSlugs) {
    if (!classification.involvedCharacterSlugs.includes(slug)) {
      violations.push({
        ruleId: "SAFETY-010",
        message: `Sexual-content claim for "${slug}" conflicts with the structured safety classification.`,
      });
    }
  }

  return { valid: violations.length === 0, classification, violations };
}
