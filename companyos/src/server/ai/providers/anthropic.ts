import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type {
  AIProvider,
  ChatMessage,
  FinishReason,
  GenerateRequest,
  GenerateResult,
  StreamEvent,
  ToolCall,
} from "@/server/ai/providers/types";
import { ProviderCapabilityError, ProviderRequestError } from "@/server/ai/providers/types";

const DEFAULT_MAX_TOKENS = 4096;

function extractSystemPrompt(messages: ChatMessage[]): string | undefined {
  return messages.find((m) => m.role === "system")?.content;
}

function toAnthropicMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];

  for (const message of messages) {
    if (message.role === "system") continue;

    if (message.role === "user") {
      result.push({ role: "user", content: message.content });
      continue;
    }

    if (message.role === "assistant") {
      const content: Anthropic.ContentBlockParam[] = [];
      if (message.content) {
        content.push({ type: "text", text: message.content });
      }
      for (const call of message.toolCalls ?? []) {
        content.push({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input: call.arguments,
        });
      }
      result.push({ role: "assistant", content });
      continue;
    }

    if (message.role === "tool") {
      result.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: message.toolCallId,
            content: message.content,
          },
        ],
      });
    }
  }

  return result;
}

function toAnthropicTools(
  tools: GenerateRequest["tools"],
): Anthropic.Tool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: "object",
      ...tool.parameters,
    } as Anthropic.Tool.InputSchema,
  }));
}

function parseResponse(message: Anthropic.Message): GenerateResult {
  let content = "";
  const toolCalls: ToolCall[] = [];

  for (const block of message.content) {
    if (block.type === "text") {
      content += block.text;
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        name: block.name,
        arguments: (block.input ?? {}) as Record<string, unknown>,
      });
    }
  }

  return {
    content,
    toolCalls,
    finishReason: mapStopReason(message.stop_reason),
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    },
  };
}

function mapStopReason(reason: Anthropic.Message["stop_reason"]): FinishReason {
  switch (reason) {
    case "tool_use":
      return "tool_calls";
    case "max_tokens":
      return "length";
    default:
      return "stop";
  }
}

export function createAnthropicProvider(apiKey: string): AIProvider {
  const client = new Anthropic({ apiKey });

  return {
    id: "anthropic",

    async generate(request: GenerateRequest): Promise<GenerateResult> {
      try {
        const message = await client.messages.create({
          model: request.model,
          system: extractSystemPrompt(request.messages),
          messages: toAnthropicMessages(request.messages),
          tools: toAnthropicTools(request.tools),
          max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
          temperature: request.temperature,
        });
        return parseResponse(message);
      } catch (err) {
        throw new ProviderRequestError("anthropic", "messages request failed", err);
      }
    },

    async *stream(request: GenerateRequest): AsyncGenerator<StreamEvent, void, unknown> {
      const stream = client.messages.stream({
        model: request.model,
        system: extractSystemPrompt(request.messages),
        messages: toAnthropicMessages(request.messages),
        tools: toAnthropicTools(request.tools),
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: request.temperature,
      });

      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield { type: "text_delta", delta: event.delta.text };
        }
      }

      const finalMessage = await stream.finalMessage();
      const result = parseResponse(finalMessage);

      for (const toolCall of result.toolCalls) {
        yield { type: "tool_call", toolCall };
      }

      yield { type: "done", result };
    },

    async embed(): Promise<number[][]> {
      throw new ProviderCapabilityError("anthropic", "embed");
    },
  };
}
