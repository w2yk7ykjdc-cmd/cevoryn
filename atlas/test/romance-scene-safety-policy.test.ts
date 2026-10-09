import assert from "node:assert/strict";
import test from "node:test";

import {
  containsSuspectedChildSexualContent,
  containsSuspectedChildSexualText,
  parseSceneSafetyClassification,
  validateSceneSafety,
} from "../src/features/romance/engine/scene-safety-policy";
import type { SceneSafetyContext } from "../src/features/romance/engine/scene-safety-policy";
import type { StructuredSceneOutput } from "../src/features/romance/engine/scene-generation-provider";

function scene(
  narration = "They discuss the bargain.",
  sceneClaims: StructuredSceneOutput["sceneClaims"] = []
): StructuredSceneOutput {
  return {
    narration,
    dialogueLines: [{ speakerSlug: "caelan", text: "I hear you." }],
    sceneClaims,
    proposedRelationshipNudge: null,
    proposedMemoryCandidates: [],
  };
}

function context(
  overrides: Partial<SceneSafetyContext["characters"]["caelan"]> = {}
): SceneSafetyContext {
  return {
    characters: {
      caelan: {
        isAdult: true,
        relationshipToPlayerSafety: "UNRELATED",
        ...overrides,
      },
    },
  };
}

function classification(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    sexualContentDetected: true,
    involvedCharacterSlugs: ["caelan"],
    ageRisk: "NONE",
    relationshipRisk: "NONE",
    consentRisk: "CLEAR",
    ...overrides,
  };
}

const sexualClaim = [
  { type: "CHARACTER_INVOLVED_IN_SEXUAL_CONTENT", characterSlug: "caelan" },
] as StructuredSceneOutput["sceneClaims"];

test("explicitly adult, unrelated, consensual intimate scene passes when every involved character has a claim", () => {
  const result = validateSceneSafety(
    scene("They kiss and move closer.", sexualClaim),
    classification(),
    context()
  );
  assert.equal(result.valid, true);
  assert.deepEqual(result.violations, []);
});

test("underage or ambiguous age classification fails closed", () => {
  const result = validateSceneSafety(
    scene("They kiss.", sexualClaim),
    classification({ ageRisk: "UNDERAGE_OR_AMBIGUOUS" }),
    context()
  );
  assert.equal(result.valid, false);
  assert.ok(result.violations.some((v) => v.ruleId === "SAFETY-004"));
});

test("adult status unknown or false fails closed even if classifier says age is clear", () => {
  for (const isAdult of [false, undefined]) {
    const result = validateSceneSafety(
      scene("They kiss.", sexualClaim),
      classification(),
      context({ isAdult: isAdult as boolean })
    );
    assert.equal(result.valid, false);
    assert.ok(result.violations.some((v) => v.ruleId === "SAFETY-007"));
  }
});

test("family, incest, and unknown relationship classifications fail closed", () => {
  for (const relationshipRisk of ["FAMILY_OR_INCEST", "UNKNOWN"]) {
    const result = validateSceneSafety(
      scene("They kiss.", sexualClaim),
      classification({ relationshipRisk }),
      context()
    );
    assert.equal(result.valid, false);
    assert.ok(result.violations.some((v) => v.ruleId === "SAFETY-005"));
  }
  const familyContext = validateSceneSafety(
    scene("They kiss.", sexualClaim),
    classification(),
    context({ relationshipToPlayerSafety: "FAMILY_MEMBER" })
  );
  assert.equal(familyContext.valid, false);
  assert.ok(familyContext.violations.some((v) => v.ruleId === "SAFETY-008"));
});

test("coercion, non-consent, and ambiguous consent fail closed", () => {
  for (const consentRisk of ["COERCION_OR_NONCONSENT", "AMBIGUOUS"]) {
    const result = validateSceneSafety(
      scene("They kiss.", sexualClaim),
      classification({ consentRisk }),
      context()
    );
    assert.equal(result.valid, false);
    assert.ok(result.violations.some((v) => v.ruleId === "SAFETY-006"));
  }
});

test("non-sexual false positives do not require an adult-eligibility record", () => {
  const result = validateSceneSafety(
    scene("They discuss the word 'desire' in a poem."),
    {
      sexualContentDetected: false,
      involvedCharacterSlugs: [],
      ageRisk: "NONE",
      relationshipRisk: "NONE",
      consentRisk: "CLEAR",
    },
    context({ isAdult: false, relationshipToPlayerSafety: "UNKNOWN" })
  );
  assert.equal(result.valid, true);
});

test("malformed or incomplete classifier output fails closed", () => {
  for (const value of [null, {}, { sexualContentDetected: true }]) {
    const result = validateSceneSafety(scene(), value, context());
    assert.equal(result.valid, false);
    assert.ok(result.violations.some((v) => v.ruleId === "SAFETY-001"));
  }
  assert.equal(parseSceneSafetyClassification({}), null);
});

test("sexual content missing the required canon claim fails closed", () => {
  const result = validateSceneSafety(
    scene("They kiss."),
    classification(),
    context()
  );
  assert.equal(result.valid, false);
  assert.ok(result.violations.some((v) => v.ruleId === "SAFETY-009"));
});

test("a claim omitted by the classifier is rejected as a classification conflict", () => {
  const result = validateSceneSafety(
    scene("They kiss.", sexualClaim),
    classification({ sexualContentDetected: false }),
    context()
  );
  assert.equal(result.valid, false);
  assert.ok(result.violations.some((v) => v.ruleId === "SAFETY-002"));
});

test("suspected underage explicit content is caught by local preflight", () => {
  assert.equal(
    containsSuspectedChildSexualContent(
      scene("The 17-year-old describes a sexual encounter.")
    ),
    true
  );
  assert.equal(
    containsSuspectedChildSexualContent(scene("Two adult characters discuss a bargain.")),
    false
  );
});


test("untrusted player input can be rejected locally before scene generation", () => {
  assert.equal(
    containsSuspectedChildSexualText("The 16-year-old asks for a sexual scene."),
    true
  );
  assert.equal(
    containsSuspectedChildSexualText("An adult asks to discuss the court bargain."),
    false
  );
});
