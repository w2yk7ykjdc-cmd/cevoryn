import "server-only";

import { LocalAIProvider } from "./local";
import { OpenAIProvider } from "./openai";
import type { AIProvider } from "./types";

export type ProviderName = "openai" | "local";

let cachedProvider: AIProvider | null = null;

export function getAIProvider(name: ProviderName = "openai"): AIProvider {
  if (cachedProvider && cachedProvider.name === name) return cachedProvider;

  switch (name) {
    case "openai":
      cachedProvider = new OpenAIProvider();
      break;
    case "local":
      cachedProvider = new LocalAIProvider();
      break;
    default: {
      const _exhaustive: never = name;
      throw new Error(`Unknown AI provider: ${_exhaustive}`);
    }
  }

  return cachedProvider;
}

export type {
  AIProvider,
  CompletionParams,
  ProviderStreamChunk,
} from "./types";
