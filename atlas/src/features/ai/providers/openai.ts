import "server-only";

import OpenAI from "openai";

import type { ChatMessage, TokenUsage } from "@/types";

import type {
  AIProvider,
  CompletionParams,
  ProviderStreamChunk,
} from "./types";

function toOpenAIRole(
  role: ChatMessage["role"]
): "user" | "assistant" | "system" {
  return role;
}

export class OpenAIProvider implements AIProvider {
  readonly name = "openai";
  private client: OpenAI;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not configured");
    }
    this.client = new OpenAI({ apiKey });
  }

  async *streamCompletion(
    params: CompletionParams
  ): AsyncGenerator<ProviderStreamChunk> {
    const stream = await this.client.chat.completions.create({
      model: params.model,
      messages: params.messages.map((m) => ({
        role: toOpenAIRole(m.role),
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

      if (delta?.content) {
        yield { type: "text", content: delta.content };
      }

      if (chunk.usage) {
        usage = {
          inputTokens: chunk.usage.prompt_tokens,
          outputTokens: chunk.usage.completion_tokens ?? 0,
          totalTokens: chunk.usage.total_tokens,
        };
      }
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
        role: toOpenAIRole(m.role),
        content: m.content,
      })),
      temperature: params.temperature ?? 0.3,
      max_tokens: params.maxTokens,
    });

    const content = response.choices[0]?.message?.content ?? "";
    const usage: TokenUsage = {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      totalTokens: response.usage?.total_tokens ?? 0,
    };

    return { content, usage };
  }
}
