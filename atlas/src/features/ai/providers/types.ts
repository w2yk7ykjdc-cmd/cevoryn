import type { ChatMessage, TokenUsage } from "@/types";

/** A single chunk from a streaming AI response */
export interface ProviderStreamChunk {
  type: "text" | "finish";
  content: string;
  usage?: TokenUsage;
}

/** Parameters for an AI completion request */
export interface CompletionParams {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "json_object";
}

/**
 * Abstract AI provider interface.
 * Implement this for each AI backend (OpenAI, Anthropic, etc.)
 */
export interface AIProvider {
  readonly name: string;

  /** Stream a chat completion. Yields chunks as they arrive. */
  streamCompletion(
    params: CompletionParams
  ): AsyncGenerator<ProviderStreamChunk>;

  /** Non-streaming completion for short tasks (e.g. title generation). */
  complete(params: CompletionParams): Promise<{
    content: string;
    usage: TokenUsage;
  }>;
}
