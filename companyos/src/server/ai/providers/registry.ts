import "server-only";
import { env } from "@/env";
import type { AIProvider, ProviderId } from "@/server/ai/providers/types";
import { createOpenAIProvider } from "@/server/ai/providers/openai";
import { createAnthropicProvider } from "@/server/ai/providers/anthropic";
import { createGeminiProvider } from "@/server/ai/providers/gemini";

const MODEL_PREFIX_TO_PROVIDER: { prefix: string; provider: ProviderId }[] = [
  { prefix: "gpt-", provider: "openai" },
  { prefix: "o1", provider: "openai" },
  { prefix: "o3", provider: "openai" },
  { prefix: "claude-", provider: "anthropic" },
  { prefix: "gemini-", provider: "google" },
];

const instances = new Map<ProviderId, AIProvider>();

/** Lazily constructs and caches the provider for `providerId`. Throws if unconfigured. */
export function getProvider(providerId: ProviderId): AIProvider {
  const cached = instances.get(providerId);
  if (cached) return cached;

  let provider: AIProvider;
  switch (providerId) {
    case "openai": {
      if (!env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY is not configured");
      }
      provider = createOpenAIProvider(env.OPENAI_API_KEY);
      break;
    }
    case "anthropic": {
      if (!env.ANTHROPIC_API_KEY) {
        throw new Error("ANTHROPIC_API_KEY is not configured");
      }
      provider = createAnthropicProvider(env.ANTHROPIC_API_KEY);
      break;
    }
    case "google": {
      if (!env.GOOGLE_GENERATIVE_AI_API_KEY) {
        throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not configured");
      }
      provider = createGeminiProvider(env.GOOGLE_GENERATIVE_AI_API_KEY);
      break;
    }
  }

  instances.set(providerId, provider);
  return provider;
}

/** Infers the provider from a model name (e.g. "claude-sonnet-5" -> anthropic). */
export function resolveProviderForModel(model: string): ProviderId {
  const match = MODEL_PREFIX_TO_PROVIDER.find(({ prefix }) => model.startsWith(prefix));
  return match?.provider ?? env.AI_DEFAULT_PROVIDER;
}

/** Resolves the provider + model to use when a caller doesn't pin one explicitly. */
export function resolveDefaultTarget(): { provider: ProviderId; model: string } {
  return { provider: env.AI_DEFAULT_PROVIDER, model: env.AI_DEFAULT_MODEL };
}

/**
 * Returns the first configured provider capable of generating embeddings.
 * Anthropic has no embeddings API, so it is skipped even if it's the chat
 * default.
 */
export function getEmbeddingProvider(): AIProvider {
  if (env.OPENAI_API_KEY) return getProvider("openai");
  if (env.GOOGLE_GENERATIVE_AI_API_KEY) return getProvider("google");
  throw new Error(
    "No embedding-capable AI provider configured. Set OPENAI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY.",
  );
}
