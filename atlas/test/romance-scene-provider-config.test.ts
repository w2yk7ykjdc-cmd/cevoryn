import assert from "node:assert/strict";
import test from "node:test";

import {
  getSceneProvider,
  OpenAISceneProvider,
} from "../src/features/romance/engine/openai-scene-provider";
import { TestSceneProvider } from "../src/features/romance/engine/scene-generation-provider";

function withEnv(
  values: Record<string, string | undefined>,
  fn: () => void
): void {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(values)) previous.set(key, process.env[key]);

  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("production fails closed instead of silently returning placeholder scenes when OPENAI_API_KEY is missing", () => {
  withEnv(
    {
      NODE_ENV: "production",
      OPENAI_API_KEY: undefined,
      ROMANCE_TEST_SCENE_PROVIDER: undefined,
    },
    () => {
      assert.throws(
        () => getSceneProvider(),
        /OPENAI_API_KEY is missing/
      );
    }
  );
});

test("the deterministic scene provider requires an explicit test context", () => {
  withEnv(
    {
      NODE_ENV: "production",
      OPENAI_API_KEY: undefined,
      ROMANCE_TEST_SCENE_PROVIDER: "true",
    },
    () => {
      assert.ok(getSceneProvider() instanceof TestSceneProvider);
    }
  );
});

test("a configured API key selects the real OpenAI scene provider", () => {
  withEnv(
    {
      NODE_ENV: "production",
      OPENAI_API_KEY: "test-key-not-used-for-network",
      ROMANCE_TEST_SCENE_PROVIDER: undefined,
    },
    () => {
      assert.ok(getSceneProvider() instanceof OpenAISceneProvider);
    }
  );
});
