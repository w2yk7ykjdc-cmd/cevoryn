import "@/server/ai/tools/builtin"; // registers built-in tools as a side effect
import { prisma } from "@/server/db/client";
import { getProvider, resolveProviderForModel } from "@/server/ai/providers/registry";
import type { ChatMessage, ProviderId, StreamEvent, ToolCall } from "@/server/ai/providers/types";
import { listToolDefinitions } from "@/server/ai/tools/registry";
import { executeToolCall } from "@/server/ai/tools/executor";
import { appendMessage, getConversationHistory, trimToTokenBudget } from "@/server/ai/memory/short-term";
import { searchMemory } from "@/server/ai/memory/long-term";
import { publishEvent } from "@/server/events/event-bus";
import { logger } from "@/server/logger/logger";
import type { RunConversationInput, RunConversationResult, ToolRoundLog } from "@/server/ai/runtime/types";

const DEFAULT_MAX_TOOL_ROUNDS = 4;
const DEFAULT_MAX_CONTEXT_TOKENS = 12_000;
const SYSTEM_PROMPT =
  "You are the CompanyOS AI Sales Employee, embedded in a multi-tenant B2B workspace. " +
  "You act only within the current organization's data and permissions, and only through your " +
  "tools — you have no direct database access, and every tool call is checked against the " +
  "caller's role before it runs. Use tools when they would produce a more accurate or verifiable " +
  "answer than your own knowledge, and never claim to have taken an action you did not actually " +
  "invoke a tool for. " +
  "When asked about a lead, or to analyze one, use get_lead and/or analyze_lead before answering — " +
  "don't guess. When analyze_lead suggests a next action, decide whether to act on it: create_task " +
  "to schedule a concrete follow-up, and record_lead_activity to leave your summary or analysis on " +
  "the lead's timeline so the team can see it without asking you again.";

/**
 * Runs one user turn to completion: persists the user message, assembles
 * context (recent history + relevant long-term memory), resolves tool calls
 * in a loop, and persists + returns the final assistant response.
 *
 * This is the non-streaming entrypoint (used by background/API-triggered
 * conversations). See `streamConversationTurn` for the SSE-friendly variant
 * used by the chat UI.
 */
export async function runConversationTurn(
  input: RunConversationInput,
): Promise<RunConversationResult> {
  const conversation = await prisma.conversation.findFirstOrThrow({
    where: { id: input.conversationId, organizationId: input.organizationId },
  });

  const model = input.model ?? conversation.model;
  const providerId: ProviderId = input.provider ?? resolveProviderForModel(model);
  const provider = getProvider(providerId);
  const maxRounds = input.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;

  await appendMessage({
    conversationId: input.conversationId,
    role: "user",
    content: input.userMessage,
  });
  await notifyMessageCreated(input, "user");

  const messages = await assembleContext(input);
  const toolRounds: ToolRoundLog[] = [];
  const tools = listToolDefinitions();
  let totalUsage = { inputTokens: 0, outputTokens: 0 };

  for (let round = 0; round <= maxRounds; round += 1) {
    const isLastAllowedRound = round === maxRounds;
    const result = await provider.generate({
      model,
      messages,
      tools: isLastAllowedRound ? undefined : tools,
      maxTokens: 2048,
    });

    totalUsage = {
      inputTokens: totalUsage.inputTokens + result.usage.inputTokens,
      outputTokens: totalUsage.outputTokens + result.usage.outputTokens,
    };

    if (result.finishReason !== "tool_calls" || result.toolCalls.length === 0) {
      await appendMessage({
        conversationId: input.conversationId,
        role: "assistant",
        content: result.content,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      });
      await notifyMessageCreated(input, "assistant");
      return { content: result.content, toolRounds, usage: totalUsage };
    }

    messages.push({ role: "assistant", content: result.content, toolCalls: result.toolCalls });
    await appendMessage({
      conversationId: input.conversationId,
      role: "assistant",
      content: result.content,
      toolCalls: result.toolCalls,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    });

    for (const call of result.toolCalls) {
      const toolResult = await executeToolCall(
        call,
        {
          organizationId: input.organizationId,
          userId: input.userId,
          conversationId: input.conversationId,
        },
        input.requestHeaders,
      );
      toolRounds.push({ toolName: call.name, input: call.arguments, result: toolResult });

      const content =
        toolResult.status === "success"
          ? JSON.stringify(toolResult.output)
          : JSON.stringify({ error: toolResult.error });

      messages.push({ role: "tool", toolCallId: call.id, toolName: call.name, content });
      await appendMessage({
        conversationId: input.conversationId,
        role: "tool",
        toolCallId: call.id,
        toolName: call.name,
        content,
      });
    }
  }

  logger.warn(
    { conversationId: input.conversationId, maxRounds },
    "conversation hit max tool-call rounds without a final answer",
  );
  return {
    content: "I wasn't able to finish resolving tool calls in time. Please try again.",
    toolRounds,
    usage: totalUsage,
  };
}

/**
 * Streaming variant: resolves any tool calls silently via the non-streaming
 * loop, then streams only the final, tool-free completion as text deltas.
 * Interleaved token-by-token tool-call streaming is not implemented in
 * Sprint 0 — callers get a fast, correct response with streaming limited to
 * the human-visible final answer.
 */
export async function* streamConversationTurn(
  input: RunConversationInput,
): AsyncGenerator<StreamEvent, void, unknown> {
  const conversation = await prisma.conversation.findFirstOrThrow({
    where: { id: input.conversationId, organizationId: input.organizationId },
  });

  const model = input.model ?? conversation.model;
  const providerId: ProviderId = input.provider ?? resolveProviderForModel(model);
  const provider = getProvider(providerId);
  const maxRounds = input.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;

  await appendMessage({ conversationId: input.conversationId, role: "user", content: input.userMessage });
  await notifyMessageCreated(input, "user");

  const messages = await assembleContext(input);
  const tools = listToolDefinitions();

  for (let round = 0; round < maxRounds; round += 1) {
    const result = await provider.generate({ model, messages, tools, maxTokens: 2048 });
    if (result.finishReason !== "tool_calls" || result.toolCalls.length === 0) {
      break;
    }

    messages.push({ role: "assistant", content: result.content, toolCalls: result.toolCalls });
    await appendMessage({
      conversationId: input.conversationId,
      role: "assistant",
      content: result.content,
      toolCalls: result.toolCalls,
    });

    for (const call of result.toolCalls) {
      const toolResult = await executeToolCall(
        call,
        { organizationId: input.organizationId, userId: input.userId, conversationId: input.conversationId },
        input.requestHeaders,
      );
      const content =
        toolResult.status === "success" ? JSON.stringify(toolResult.output) : JSON.stringify({ error: toolResult.error });
      messages.push({ role: "tool", toolCallId: call.id, toolName: call.name, content });
      await appendMessage({
        conversationId: input.conversationId,
        role: "tool",
        toolCallId: call.id,
        toolName: call.name,
        content,
      });
    }
  }

  let finalContent = "";
  for await (const event of provider.stream({ model, messages, maxTokens: 2048 })) {
    if (event.type === "text_delta") finalContent += event.delta;
    yield event;
  }

  await appendMessage({ conversationId: input.conversationId, role: "assistant", content: finalContent });
  await notifyMessageCreated(input, "assistant");
}

async function assembleContext(input: RunConversationInput): Promise<ChatMessage[]> {
  const history = await getConversationHistory(input.conversationId);
  const relevantMemory = await searchMemory({
    organizationId: input.organizationId,
    userId: input.userId,
    query: input.userMessage,
    limit: 5,
  }).catch((err) => {
    logger.warn({ err }, "long-term memory search unavailable; continuing without it");
    return [];
  });

  const memoryContext: ChatMessage[] =
    relevantMemory.length > 0
      ? [
          {
            role: "system",
            content:
              "Relevant memory from previous interactions:\n" +
              relevantMemory.map((m) => `- (${m.kind}) ${m.content}`).join("\n"),
          },
        ]
      : [];

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...memoryContext,
    ...history,
  ];

  return trimToTokenBudget(messages, input.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS);
}

async function notifyMessageCreated(input: RunConversationInput, role: "user" | "assistant") {
  await publishEvent(
    "ai.conversation.message_created",
    {
      conversationId: input.conversationId,
      messageId: "", // best-effort notification; the row is the source of truth
      organizationId: input.organizationId,
      role,
    },
    { organizationId: input.organizationId },
  );
}

export type { ToolCall };
