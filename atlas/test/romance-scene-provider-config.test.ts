import assert from "node:assert/strict";
import test from "node:test";

import { SceneGenerationError, TestSceneProvider } from "../src/features/romance/engine/scene-generation-provider";
import { selectSceneProvider } from "../src/features/romance/engine/scene-provider-selection";

const realProvider = { name: "real-provider", generateScene: async () => ({
  narration: "configured",
  dialogueLines: [],
  sceneClaims: [],
  proposedRelationshipNudge: null,
  proposedMemoryCandidates: [],
}) };

test("production fails closed instead of silently returning placeholder scenes when OPENAI_API_KEY is missing", () => {
  assert.throws(
    () => selectSceneProvider({ NODE_ENV: "production" }, () => realProvider),
    (error: unknown) => error instanceof SceneGenerationError && /OPENAI_API_KEY is missing/.test(error.message)
  );
});

test("the deterministic scene provider requires an explicit test context", () => {
  assert.ok(
    selectSceneProvider(
      { NODE_ENV: "development", ROMANCE_TEST_SCENE_PROVIDER: "true" },
      () => realProvider
    ) instanceof TestSceneProvider
  );
});

test("the test-provider opt-in cannot enable placeholder scenes in production", () => {
  assert.throws(
    () =>
      selectSceneProvider(
        { NODE_ENV: "production", ROMANCE_TEST_SCENE_PROVIDER: "true" },
        () => realProvider
      ),
    /OPENAI_API_KEY is missing/
  );
});

test("a configured API key selects the real provider", () => {
  assert.equal(
    selectSceneProvider(
      { NODE_ENV: "production", OPENAI_API_KEY: "test-key-not-used-for-network" },
      () => realProvider
    ),
    realProvider
  );
});

test("NODE_ENV=test explicitly permits the deterministic provider without a key", () => {
  assert.ok(
    selectSceneProvider({ NODE_ENV: "test" }, () => realProvider) instanceof TestSceneProvider
  );
});
