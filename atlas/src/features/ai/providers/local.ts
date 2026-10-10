import "server-only";

import OpenAI from "openai";

import { recordStandaloneUsage } from "@/features/ai/engine/token-tracker";
import { getAIUsageContext } from "@/features/ai/usage-context";
import type { ChatMessage, TokenUsage } from "@/types";

import type {
  AIProvider,
  CompletionParams,
  ProviderStreamChunk,
} from "./types";

function toRole(role: ChatMessage["role"]): "user" | "assistant" | "system" {
  return role;
}

function usageOf(u?: OpenAI.CompletionUsage | null): TokenUsage {
  return {
    inputTokens: u?.prompt_tokens ?? 0,
    outputTokens: u?.completion_tokens ?? 0,
    totalTokens: u?.total_tokens ?? 0,
  };
}

/**
 * OpenAI-compatible local inference backend.
 *
 * The Next.js app does not know anything about CUDA/SGLang/DeepGEMM.
 * Configure LOCAL_AI_BASE_URL and LOCAL_AI_API_KEY for the runtime.
 */
export class LocalAIProvider implements AIProvider {
  readonly name = "local";
  private readonly client: OpenAI;

  constructor() {
    const baseURL = process.env.LOCAL_AI_BASE_URL;
    if (!baseURL) throw new Error("LOCAL_AI_BASE_URL is not configured");

    this.client = new OpenAI({
      apiKey: process.env.LOCAL_AI_API_KEY ?? "local-runtime",
      baseURL,
    });
  }

  async *streamCompletion(
    params: CompletionParams
  ): AsyncGenerator<ProviderStreamChunk> {
    const stream = await this.client.chat.completions.create({
      model: params.model,
      messages: params.messages.map((m) => ({
        role: toRole(m.role),
        content: m.content,
      })),
      temperature: params.temperature ?? 0.7,
      max_tokens: params.maxTokens,
      stream: true,
      stream_options: { include_usage: true },
    });

    let usage: TokenUsage | undefined;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) yield { type: "text", content: delta.content };
      if (chunk.usage) usage = usageOf(chunk.usage);
    }

    yield {
      type: "finish",
      content: "",
      usage: usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    };
  }

  async complete(
    params: CompletionParams
  ): Promise<{ content: string; usage: TokenUsage }> {
    const response = await this.client.chat.completions.create({
      model: params.model,
      messages: params.messages.map((m) => ({
        role: toRole(m.role),
        content: m.content,
      })),
      temperature: params.temperature ?? 0.3,
      max_tokens: params.maxTokens,
    });

    const content = response.choices[0]?.message?.content ?? "";
    const usage = usageOf(response.usage);

    const usageContext = getAIUsageContext();
    if (usageContext && usage.totalTokens > 0) {
      await recordStandaloneUsage({
        organizationId: usageContext.organizationId,
        userId: usageContext.userId,
        model: params.model,
        usage,
      });
    }

    return { content, usage };
  }
}
