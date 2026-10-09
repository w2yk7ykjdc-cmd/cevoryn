import assert from "node:assert/strict";
import test from "node:test";

import { generateValidatedScene } from "../src/features/romance/engine/scene-pipeline.service";
import { TestSceneProvider } from "../src/features/romance/engine/scene-generation-provider";
import type {
  SceneGenerationContext,
  StructuredSceneOutput,
} from "../src/features/romance/engine/scene-generation-provider";
import type { CanonContext } from "../src/features/romance/engine/types";
import type {
  SceneSafetyClassifier,
  SceneSafetyContext,
} from "../src/features/romance/engine/scene-safety-policy";

function baseContext(): SceneGenerationContext {
  return {
    beatSlug: "bargain",
    beatName: "The Bargain",
    intent: {
      type: "ASK_QUESTION",
      content: "What do you want from me?",
      flags: { possiblePromptInjection: false },
    },
    targetCharacterSlug: "caelan",
    relevantMemories: [],
    relevantCanonFacts: [],
    relationshipState: null,
    characterKnowledgeScope: null,
    characterVoice: null,
  };
}

function emptyCanonContext(): CanonContext {
  return {
    trueNameRevealedTo: new Set(),
    knownBargainIds: new Set(),
    knownPromiseIds: new Set(),
    adultCharacterSlugs: new Set(),
  };
}

function safeSafetyContext(): SceneSafetyContext {
  return {
    characters: {
      caelan: {
        isAdult: true,
        relationshipToPlayerSafety: "UNRELATED",
      },
    },
  };
}

const safeSafetyClassifier: SceneSafetyClassifier = {
  async classify() {
    return {
      sexualContentDetected: false,
      involvedCharacterSlugs: [],
      ageRisk: "NONE",
      relationshipRisk: "NONE",
      consentRisk: "CLEAR",
    };
  },
};

function validScene(narration = "A valid scene."): StructuredSceneOutput {
  return {
    narration,
    dialogueLines: [{ speakerSlug: "caelan", text: "..." }],
    sceneClaims: [],
    proposedRelationshipNudge: null,
    proposedMemoryCandidates: [],
  };
}

function invalidScene(): StructuredSceneOutput {
  return {
    narration: "Caelan speaks your true name.",
    dialogueLines: [
      { speakerSlug: "caelan", text: "I know your true name now." },
    ],
    sceneClaims: [
      { type: "CHARACTER_KNOWS_TRUE_NAME", characterSlug: "caelan" },
    ],
    proposedRelationshipNudge: null,
    proposedMemoryCandidates: [],
  };
}

test("a valid first attempt is returned as-is, no recovery needed", async () => {
  const provider = new TestSceneProvider(() => validScene());
  const result = await generateValidatedScene(
    provider,
    baseContext(),
    emptyCanonContext(),
  safeSafetyContext(),
  safeSafetyClassifier
  );

  assert.equal(result.valid, true);
  assert.equal(result.attempts, 1);
  assert.equal(result.failureReason, null);
  assert.deepEqual(result.violationsEncountered, []);
});

test("an invalid first attempt that becomes valid on regenerate is accepted and labeled 'regenerated'", async () => {
  let calls = 0;
  const provider = new TestSceneProvider(() => {
    calls++;
    return calls === 1 ? invalidScene() : validScene();
  });

  const result = await generateValidatedScene(
    provider,
    baseContext(),
    emptyCanonContext(),
  safeSafetyContext(),
  safeSafetyClassifier
  );

  assert.equal(result.valid, true);
  assert.equal(result.attempts, 2);
  assert.equal(result.failureReason, "regenerated");
  assert.equal(result.violationsEncountered.length, 1);
  assert.equal(result.violationsEncountered[0]?.ruleId, "CANON-001");
});

test("an invalid attempt that only becomes valid on the third (repair) try cites prior violations in context", async () => {
  let calls = 0;
  const seenPriorViolations: unknown[] = [];
  const provider = new TestSceneProvider((ctx) => {
    calls++;
    seenPriorViolations.push(ctx.priorViolations);
    return calls < 3 ? invalidScene() : validScene();
  });

  const result = await generateValidatedScene(
    provider,
    baseContext(),
    emptyCanonContext(),
  safeSafetyContext(),
  safeSafetyClassifier
  );

  assert.equal(result.valid, true);
  assert.equal(result.attempts, 3);
  assert.equal(result.failureReason, "repaired");
  // The third (repair) attempt's context carried the two prior violations.
  assert.equal(
    Array.isArray(seenPriorViolations[2]) &&
      (seenPriorViolations[2] as unknown[]).length,
    2
  );
});

test("a scene that never validates falls back to the safe deterministic scene, never shown invalid", async () => {
  const provider = new TestSceneProvider(() => invalidScene());
  const result = await generateValidatedScene(
    provider,
    baseContext(),
    emptyCanonContext(),
  safeSafetyContext(),
  safeSafetyClassifier
  );

  assert.equal(result.valid, true);
  assert.equal(result.failureReason, "fallback");
  assert.deepEqual(result.scene.sceneClaims, []);
  assert.equal(result.violationsEncountered.length, 3);
  // The fallback scene itself makes no claims, so it is never the invalid content shown to the player.
  assert.notEqual(result.scene.narration, invalidScene().narration);
});

function repetitiveScene(): StructuredSceneOutput {
  return {
    narration:
      "Caelan hesitates, his gaze wavering as he processes your request, clearly uncertain whether to answer honestly.",
    dialogueLines: [
      {
        speakerSlug: "caelan",
        text: "I hesitate, uncertain whether I should answer your request honestly, my gaze wavering as I process this.",
      },
    ],
    sceneClaims: [],
    proposedRelationshipNudge: null,
    proposedMemoryCandidates: [],
  };
}

test("canon-valid but repetitive prose is rejected and regenerated, never shown to the player", async () => {
  let calls = 0;
  const provider = new TestSceneProvider(() => {
    calls++;
    return calls === 1 ? repetitiveScene() : validScene();
  });

  const result = await generateValidatedScene(
    provider,
    baseContext(),
    emptyCanonContext(),
  safeSafetyContext(),
  safeSafetyClassifier
  );

  assert.equal(result.valid, true);
  assert.equal(result.attempts, 2);
  assert.equal(result.failureReason, "regenerated");
  assert.equal(result.qualityIssuesEncountered.length, 1);
  assert.equal(result.qualityIssuesEncountered[0]!.code, "REPETITIVE_DIALOGUE");
  assert.notEqual(result.scene.narration, repetitiveScene().narration);
});

test("prose-quality issues from earlier attempts are cited in the repair (3rd) attempt's context", async () => {
  let calls = 0;
  const seenPriorViolations: unknown[] = [];
  const provider = new TestSceneProvider((ctx) => {
    calls++;
    seenPriorViolations.push(ctx.priorViolations);
    return calls < 3 ? repetitiveScene() : validScene();
  });

  const result = await generateValidatedScene(
    provider,
    baseContext(),
    emptyCanonContext(),
  safeSafetyContext(),
  safeSafetyClassifier
  );

  assert.equal(result.valid, true);
  assert.equal(result.attempts, 3);
  assert.equal(result.failureReason, "repaired");
  const thirdAttemptPriorViolations = seenPriorViolations[2] as Array<{
    ruleId: string;
  }>;
  assert.ok(
    thirdAttemptPriorViolations.some((v) => v.ruleId === "REPETITIVE_DIALOGUE")
  );
});


test("a transient safety-classifier failure rejects that attempt and retries before returning a valid scene", async () => {
  let calls = 0;
  const classifier: SceneSafetyClassifier = {
    async classify() {
      calls++;
      if (calls === 1) throw new Error("classifier timeout");
      return {
        sexualContentDetected: false,
        involvedCharacterSlugs: [],
        ageRisk: "NONE",
        relationshipRisk: "NONE",
        consentRisk: "CLEAR",
      };
    },
  };

  const result = await generateValidatedScene(
    new TestSceneProvider(() => validScene()),
    baseContext(),
    emptyCanonContext(),
    safeSafetyContext(),
    classifier
  );

  assert.equal(result.valid, true);
  assert.equal(result.attempts, 2);
  assert.equal(result.failureReason, "regenerated");
  assert.ok(result.safetyViolationsEncountered.some((v) => v.ruleId === "SAFETY-012"));
});

test("repeated safety-classifier failures return only the policy-safe fallback", async () => {
  let calls = 0;
  const classifier: SceneSafetyClassifier = {
    async classify() {
      calls++;
      throw new Error("classifier unavailable");
    },
  };

  const result = await generateValidatedScene(
    new TestSceneProvider(() => validScene("Never show this without classification.")),
    baseContext(),
    emptyCanonContext(),
    safeSafetyContext(),
    classifier
  );

  assert.equal(calls, 3);
  assert.equal(result.valid, true);
  assert.equal(result.failureReason, "fallback");
  assert.equal(result.scene.narration.includes("Never show this"), false);
  assert.ok(result.safetyViolationsEncountered.length >= 3);
});

test("potentially unsafe age/content combination is rejected before the classifier is called", async () => {
  let classifierCalls = 0;
  let providerCalls = 0;
  const classifier: SceneSafetyClassifier = {
    async classify() {
      classifierCalls++;
      return {
        sexualContentDetected: false,
        involvedCharacterSlugs: [],
        ageRisk: "NONE",
        relationshipRisk: "NONE",
        consentRisk: "CLEAR",
      };
    },
  };

  const result = await generateValidatedScene(
    new TestSceneProvider(() => {
      providerCalls++;
      return validScene("The 17-year-old describes a sexual encounter.");
    }),
    baseContext(),
    emptyCanonContext(),
    safeSafetyContext(),
    classifier
  );

  assert.equal(providerCalls, 3);
  assert.equal(classifierCalls, 0);
  assert.equal(result.failureReason, "fallback");
  assert.ok(result.safetyViolationsEncountered.some((v) => v.ruleId === "SAFETY-011"));
});


test("repeated scene-provider failures return the deterministic safe fallback", async () => {
  let calls = 0;
  const provider = new TestSceneProvider(() => {
    calls++;
    throw new Error("scene provider timeout");
  });

  const result = await generateValidatedScene(
    provider,
    baseContext(),
    emptyCanonContext(),
    safeSafetyContext(),
    safeSafetyClassifier
  );

  assert.equal(calls, 3);
  assert.equal(result.valid, true);
  assert.equal(result.failureReason, "fallback");
  assert.equal(result.scene.sceneClaims.length, 0);
  assert.equal(result.scene.narration.includes("provider timeout"), false);
});
