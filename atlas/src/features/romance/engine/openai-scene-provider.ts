import "server-only";

import { getAIProvider } from "@/features/ai/providers";

import {
  SCENE_SYSTEM_PROMPT,
  buildSceneUserPrompt,
  parseStructuredSceneOutput,
} from "./scene-generation-provider";
import type {
  LLMProvider,
  SceneGenerationContext,
  StructuredSceneOutput,
} from "./scene-generation-provider";
import { selectSceneProvider } from "./scene-provider-selection";

/**
 * Production scene provider - real code, wired through the existing
 * AIProvider interface (reused, not a new vendor SDK embedded directly
 * in domain logic - brief §26). Real model calls require configured
 * credentials and are verified separately from deterministic unit tests.
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
  return selectSceneProvider(process.env, () => new OpenAISceneProvider());
}
