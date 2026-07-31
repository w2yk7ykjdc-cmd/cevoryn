import { GoogleGenAI, FunctionCallingConfigMode } from "@google/genai";
import type { Content, Part } from "@google/genai";
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

const DEFAULT_EMBEDDING_MODEL = "text-embedding-004";

function extractSystemPrompt(messages: ChatMessage[]): string | undefined {
  return messages.find((m) => m.role === "system")?.content;
}

function toGeminiContents(messages: ChatMessage[]): Content[] {
  const contents: Content[] = [];

  for (const message of messages) {
    if (message.role === "system") continue;

    if (message.role === "user") {
      contents.push({ role: "user", parts: [{ text: message.content }] });
      continue;
    }

    if (message.role === "assistant") {
      const parts: Part[] = [];
      if (message.content) parts.push({ text: message.content });
      for (const call of message.toolCalls ?? []) {
        parts.push({ functionCall: { id: call.id, name: call.name, args: call.arguments } });
      }
      contents.push({ role: "model", parts });
      continue;
    }

    if (message.role === "tool") {
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              id: message.toolCallId,
              name: message.toolName,
              response: { result: message.content },
            },
          },
        ],
      });
    }
  }

  return contents;
}

function toGeminiTools(tools: GenerateRequest["tools"]) {
  if (!tools || tools.length === 0) return undefined;
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parametersJsonSchema: tool.parameters,
      })),
    },
  ];
}

function mapFinishReason(reason: string | undefined, hasFunctionCalls: boolean): FinishReason {
  if (hasFunctionCalls) return "tool_calls";
  switch (reason) {
    case "MAX_TOKENS":
      return "length";
    case "SAFETY":
    case "PROHIBITED_CONTENT":
    case "BLOCKLIST":
      return "content_filter";
    default:
      return "stop";
  }
}

export function createGeminiProvider(apiKey: string): AIProvider {
  const client = new GoogleGenAI({ apiKey });

  return {
    id: "google",

    async generate(request: GenerateRequest): Promise<GenerateResult> {
      try {
        const response = await client.models.generateContent({
          model: request.model,
          contents: toGeminiContents(request.messages),
          config: {
            systemInstruction: extractSystemPrompt(request.messages),
            tools: toGeminiTools(request.tools),
            ...(request.tools?.length
              ? { toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } } }
              : {}),
            maxOutputTokens: request.maxTokens,
            temperature: request.temperature,
          },
        });

        const functionCalls = response.functionCalls ?? [];
        const toolCalls: ToolCall[] = functionCalls.map((call, index) => ({
          id: call.id ?? `${index}`,
          name: call.name ?? "",
          arguments: call.args ?? {},
        }));

        return {
          content: response.text ?? "",
          toolCalls,
          finishReason: mapFinishReason(
            response.candidates?.[0]?.finishReason,
            toolCalls.length > 0,
          ),
          usage: {
            inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
            outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
          },
        };
      } catch (err) {
        throw new ProviderRequestError("google", "generateContent request failed", err);
      }
    },

    async *stream(request: GenerateRequest): AsyncGenerator<StreamEvent, void, unknown> {
      const stream = await client.models.generateContentStream({
        model: request.model,
        contents: toGeminiContents(request.messages),
        config: {
          systemInstruction: extractSystemPrompt(request.messages),
          tools: toGeminiTools(request.tools),
          maxOutputTokens: request.maxTokens,
          temperature: request.temperature,
        },
      });

      let content = "";
      const toolCalls: ToolCall[] = [];
      let finishReason: FinishReason = "stop";
      let usage: GenerateResult["usage"] = { inputTokens: 0, outputTokens: 0 };

      for await (const chunk of stream) {
        if (chunk.text) {
          content += chunk.text;
          yield { type: "text_delta", delta: chunk.text };
        }
        for (const call of chunk.functionCalls ?? []) {
          const toolCall: ToolCall = {
            id: call.id ?? `${toolCalls.length}`,
            name: call.name ?? "",
            arguments: call.args ?? {},
          };
          toolCalls.push(toolCall);
          yield { type: "tool_call", toolCall };
        }
        if (chunk.candidates?.[0]?.finishReason) {
          finishReason = mapFinishReason(chunk.candidates[0].finishReason, toolCalls.length > 0);
        }
        if (chunk.usageMetadata) {
          usage = {
            inputTokens: chunk.usageMetadata.promptTokenCount ?? 0,
            outputTokens: chunk.usageMetadata.candidatesTokenCount ?? 0,
          };
        }
      }

      yield { type: "done", result: { content, toolCalls, finishReason, usage } };
    },

    async embed(input: string[]): Promise<number[][]> {
      try {
        const response = await client.models.embedContent({
          model: DEFAULT_EMBEDDING_MODEL,
          contents: input,
        });
        return (response.embeddings ?? []).map((embedding) => embedding.values ?? []);
      } catch (err) {
        throw new ProviderRequestError("google", "embedContent request failed", err);
      }
    },
  };
}
