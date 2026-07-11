import "server-only";

import { OpenAIProvider } from "./openai";
import type { AIProvider } from "./types";

export type ProviderName = "openai";

let cachedProvider: AIProvider | null = null;

/**
 * Get the configured AI provider.
 * Currently supports OpenAI. The factory pattern makes it trivial
 * to add Anthropic, Gemini, or local models later.
 */
export function getAIProvider(name: ProviderName = "openai"): AIProvider {
  if (cachedProvider && cachedProvider.name === name) {
    return cachedProvider;
  }

  switch (name) {
    case "openai":
      cachedProvider = new OpenAIProvider();
      break;
    default: {
      const _exhaustive: never = name;
      throw new Error(`Unknown AI provider: ${_exhaustive}`);
    }
  }

  return cachedProvider;
}

export type { AIProvider, CompletionParams, ProviderStreamChunk } from "./types";
