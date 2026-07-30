export type ProviderId = "openai" | "anthropic" | "google";

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; toolName: string; content: string };

export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

/** JSON-Schema tool definition, provider-agnostic (each adapter translates it). */
export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type GenerateRequest = {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
};

export type FinishReason = "stop" | "tool_calls" | "length" | "content_filter";

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type GenerateResult = {
  content: string;
  toolCalls: ToolCall[];
  finishReason: FinishReason;
  usage: TokenUsage;
};

export type StreamEvent =
  | { type: "text_delta"; delta: string }
  | { type: "tool_call"; toolCall: ToolCall }
  | { type: "done"; result: GenerateResult };

export interface AIProvider {
  readonly id: ProviderId;
  generate(request: GenerateRequest): Promise<GenerateResult>;
  stream(request: GenerateRequest): AsyncGenerator<StreamEvent, void, unknown>;
  /** Throws `ProviderCapabilityError` if the provider has no embedding model. */
  embed(input: string[]): Promise<number[][]>;
}

export class ProviderCapabilityError extends Error {
  constructor(provider: ProviderId, capability: string) {
    super(`Provider "${provider}" does not support capability "${capability}"`);
    this.name = "ProviderCapabilityError";
  }
}

export class ProviderRequestError extends Error {
  constructor(
    public readonly provider: ProviderId,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(`[${provider}] ${message}`);
    this.name = "ProviderRequestError";
  }
}
