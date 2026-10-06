import assert from "node:assert/strict";
import test from "node:test";

import { generateValidatedScene } from "../src/features/romance/engine/scene-pipeline.service";
import { TestSceneProvider } from "../src/features/romance/engine/scene-generation-provider";
import type {
  SceneGenerationContext,
  StructuredSceneOutput,
} from "../src/features/romance/engine/scene-generation-provider";
import type { CanonContext } from "../src/features/romance/engine/types";

function baseContext(): SceneGenerationContext {
  return {
    beatSlug: "bargain",
    beatName: "The Bargain",
    intent: { type: "ASK_QUESTION", content: "What do you want from me?", flags: { possiblePromptInjection: false } },
    targetCharacterSlug: "caelan",
    relevantMemories: [],
    relevantCanonFacts: [],
    relationshipState: null,
    characterKnowledgeScope: null,
  };
}

function emptyCanonContext(): CanonContext {
  return {
    trueNameRevealedTo: new Set(),
    knownBargainIds: new Set(),
    knownPromiseIds: new Set(),
  };
}

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
    dialogueLines: [{ speakerSlug: "caelan", text: "I know your true name now." }],
    sceneClaims: [{ type: "CHARACTER_KNOWS_TRUE_NAME", characterSlug: "caelan" }],
    proposedRelationshipNudge: null,
    proposedMemoryCandidates: [],
  };
}

test("a valid first attempt is returned as-is, no recovery needed", async () => {
  const provider = new TestSceneProvider(() => validScene());
  const result = await generateValidatedScene(provider, baseContext(), emptyCanonContext());

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

  const result = await generateValidatedScene(provider, baseContext(), emptyCanonContext());

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

  const result = await generateValidatedScene(provider, baseContext(), emptyCanonContext());

  assert.equal(result.valid, true);
  assert.equal(result.attempts, 3);
  assert.equal(result.failureReason, "repaired");
  // The third (repair) attempt's context carried the two prior violations.
  assert.equal(
    Array.isArray(seenPriorViolations[2]) && (seenPriorViolations[2] as unknown[]).length,
    2
  );
});

test("a scene that never validates falls back to the safe deterministic scene, never shown invalid", async () => {
  const provider = new TestSceneProvider(() => invalidScene());
  const result = await generateValidatedScene(provider, baseContext(), emptyCanonContext());

  assert.equal(result.valid, true);
  assert.equal(result.failureReason, "fallback");
  assert.deepEqual(result.scene.sceneClaims, []);
  assert.equal(result.violationsEncountered.length, 3);
  // The fallback scene itself makes no claims, so it is never the invalid content shown to the player.
  assert.notEqual(result.scene.narration, invalidScene().narration);
});
