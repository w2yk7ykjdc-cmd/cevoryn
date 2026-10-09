import "server-only";

import { getAIProvider } from "@/features/ai/providers";

import {
  SCENE_SYSTEM_PROMPT,
  SceneGenerationError,
  TestSceneProvider,
  buildSceneUserPrompt,
  parseStructuredSceneOutput,
} from "./scene-generation-provider";
import type {
  LLMProvider,
  SceneGenerationContext,
  StructuredSceneOutput,
} from "./scene-generation-provider";

/**
 * Production scene provider - real code, wired through the existing
 * AIProvider interface (reused, not a new vendor SDK embedded directly
 * in domain logic - brief §26). NOT exercised against a real model in
 * this sandbox (no OPENAI_API_KEY) - see the final report's
 * known-limitations section. Never used by default in tests; tests
 * inject TestSceneProvider directly instead.
 */
export class OpenAISceneProvider implements LLMProvider {
  readonly name = "openai-scene-provider";

  async generateScene(context: SceneGenerationContext): Promise<StructuredSceneOutput> {
    const provider = getAIProvider("openai");
    const { content } = await provider.complete({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SCENE_SYSTEM_PROMPT },
        { role: "user", content: buildSceneUserPrompt(context) },
      ],
      temperature: 0.8,
      maxTokens: 900,
      responseFormat: "json_object",
    });
    return parseStructuredSceneOutput(content);
  }
}

/**
 * Runtime default. A deterministic test provider is permitted only in an
 * explicit test context; a missing production API key must never silently
 * turn a paid story session into placeholder fiction.
 */
export function getSceneProvider(): LLMProvider {
  if (process.env.OPENAI_API_KEY?.trim()) {
    return new OpenAISceneProvider();
  }

  const testProviderExplicitlyEnabled =
    process.env.NODE_ENV === "test" ||
    process.env.ROMANCE_TEST_SCENE_PROVIDER === "true";

  if (testProviderExplicitlyEnabled) {
    return new TestSceneProvider();
  }

  throw new SceneGenerationError(
    "Romance scene generation is not configured: OPENAI_API_KEY is missing. " +
      "Configure a real provider or explicitly enable the test provider only in an isolated test environment."
  );
}
