import OpenAI from "openai";
import type {
  AIProvider,
  ChatMessage,
  FinishReason,
  GenerateRequest,
  GenerateResult,
  StreamEvent,
  ToolCall,
} from "@/server/ai/providers/types";
import { ProviderRequestError } from "@/server/ai/providers/types";

const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

function toOpenAiMessages(
  messages: ChatMessage[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return messages.map((message) => {
    switch (message.role) {
      case "system":
        return { role: "system", content: message.content };
      case "user":
        return { role: "user", content: message.content };
      case "tool":
        return {
          role: "tool",
          tool_call_id: message.toolCallId,
          content: message.content,
        };
      case "assistant":
        return {
          role: "assistant",
          content: message.content || null,
          tool_calls: message.toolCalls?.map((call) => ({
            id: call.id,
            type: "function" as const,
            function: {
              name: call.name,
              arguments: JSON.stringify(call.arguments),
            },
          })),
        };
    }
  });
}

function toOpenAiTools(
  tools: GenerateRequest["tools"],
): OpenAI.Chat.Completions.ChatCompletionTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function parseToolCalls(
  toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] | undefined,
): ToolCall[] {
  if (!toolCalls) return [];
  return toolCalls
    .filter((call) => call.type === "function")
    .map((call) => ({
      id: call.id,
      name: call.function.name,
      arguments: safeJsonParse(call.function.arguments),
    }));
}

function safeJsonParse(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function mapFinishReason(reason: string | null): FinishReason {
  switch (reason) {
    case "tool_calls":
      return "tool_calls";
    case "length":
      return "length";
    case "content_filter":
      return "content_filter";
    default:
      return "stop";
  }
}

export function createOpenAIProvider(apiKey: string): AIProvider {
  const client = new OpenAI({ apiKey });

  return {
    id: "openai",

    async generate(request: GenerateRequest): Promise<GenerateResult> {
      try {
        const completion = await client.chat.completions.create({
          model: request.model,
          messages: toOpenAiMessages(request.messages),
          tools: toOpenAiTools(request.tools),
          max_tokens: request.maxTokens,
          temperature: request.temperature,
        });

        const choice = completion.choices[0];
        if (!choice) {
          throw new ProviderRequestError("openai", "response contained no choices");
        }

        return {
          content: choice.message.content ?? "",
          toolCalls: parseToolCalls(choice.message.tool_calls),
          finishReason: mapFinishReason(choice.finish_reason),
          usage: {
            inputTokens: completion.usage?.prompt_tokens ?? 0,
            outputTokens: completion.usage?.completion_tokens ?? 0,
          },
        };
      } catch (err) {
        if (err instanceof ProviderRequestError) throw err;
        throw new ProviderRequestError("openai", "chat completion request failed", err);
      }
    },

    async *stream(request: GenerateRequest): AsyncGenerator<StreamEvent, void, unknown> {
      const stream = await client.chat.completions.create({
        model: request.model,
        messages: toOpenAiMessages(request.messages),
        tools: toOpenAiTools(request.tools),
        max_tokens: request.maxTokens,
        temperature: request.temperature,
        stream: true,
        stream_options: { include_usage: true },
      });

      let content = "";
      const pendingToolCalls = new Map<
        number,
        { id: string; name: string; arguments: string }
      >();
      let finishReason: FinishReason = "stop";
      let usage: GenerateResult["usage"] = { inputTokens: 0, outputTokens: 0 };

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (chunk.usage) {
          usage = {
            inputTokens: chunk.usage.prompt_tokens,
            outputTokens: chunk.usage.completion_tokens,
          };
        }
        if (!choice) continue;

        if (choice.delta?.content) {
          content += choice.delta.content;
          yield { type: "text_delta", delta: choice.delta.content };
        }

        for (const toolCallDelta of choice.delta?.tool_calls ?? []) {
          const existing = pendingToolCalls.get(toolCallDelta.index) ?? {
            id: toolCallDelta.id ?? "",
            name: toolCallDelta.function?.name ?? "",
            arguments: "",
          };
          if (toolCallDelta.id) existing.id = toolCallDelta.id;
          if (toolCallDelta.function?.name) existing.name = toolCallDelta.function.name;
          if (toolCallDelta.function?.arguments) {
            existing.arguments += toolCallDelta.function.arguments;
          }
          pendingToolCalls.set(toolCallDelta.index, existing);
        }

        if (choice.finish_reason) {
          finishReason = mapFinishReason(choice.finish_reason);
        }
      }

      const toolCalls: ToolCall[] = Array.from(pendingToolCalls.values()).map((call) => ({
        id: call.id,
        name: call.name,
        arguments: safeJsonParse(call.arguments),
      }));

      for (const toolCall of toolCalls) {
        yield { type: "tool_call", toolCall };
      }

      yield {
        type: "done",
        result: { content, toolCalls, finishReason, usage },
      };
    },

    async embed(input: string[]): Promise<number[][]> {
      try {
        const response = await client.embeddings.create({
          model: DEFAULT_EMBEDDING_MODEL,
          input,
        });
        return response.data
          .sort((a, b) => a.index - b.index)
          .map((item) => item.embedding);
      } catch (err) {
        throw new ProviderRequestError("openai", "embedding request failed", err);
      }
    },
  };
}
