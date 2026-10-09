import { SceneGenerationError, TestSceneProvider } from "./scene-generation-provider";
import type { LLMProvider } from "./scene-generation-provider";

export interface SceneProviderEnvironment {
  NODE_ENV?: string;
  OPENAI_API_KEY?: string;
  ROMANCE_TEST_SCENE_PROVIDER?: string;
}

/**
 * Pure provider selection logic so runtime configuration can be tested
 * without importing the server-only OpenAI implementation into Node tests.
 */
export function selectSceneProvider(
  env: SceneProviderEnvironment,
  createRealProvider: () => LLMProvider
): LLMProvider {
  if (env.OPENAI_API_KEY?.trim()) return createRealProvider();

  const testProviderExplicitlyEnabled =
    env.NODE_ENV === "test" ||
    (env.NODE_ENV !== "production" &&
      env.ROMANCE_TEST_SCENE_PROVIDER === "true");

  if (testProviderExplicitlyEnabled) return new TestSceneProvider();

  throw new SceneGenerationError(
    "Romance scene generation is not configured: OPENAI_API_KEY is missing. " +
      "Configure a real provider or explicitly enable the test provider only in an isolated test environment."
  );
}
