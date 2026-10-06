import "server-only";

import { getAIProvider } from "@/features/ai/providers";

import {
  SCENE_SYSTEM_PROMPT,
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

let cachedProvider: LLMProvider | null = null;

/** Runtime default: TestSceneProvider when no real provider is configured, never a silent fake-as-real. */
export function getSceneProvider(): LLMProvider {
  if (cachedProvider) return cachedProvider;
  cachedProvider = process.env.OPENAI_API_KEY
    ? new OpenAISceneProvider()
    : new TestSceneProvider();
  return cachedProvider;
}
