import "server-only";

import { initializeBrain } from "@/features/brain/bootstrap";
import {
  gatherBrainContext,
  processExchange,
} from "@/features/brain/core/atlas-engine";
import { AI_CONFIG } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import type { MembershipContext, StreamChunk } from "@/types";

import { buildContext } from "../context/context-builder";
import { TITLE_GENERATION_PROMPT } from "../context/prompts";
import { getAIProvider } from "../providers";

import { recordUsage } from "./token-tracker";

// Ensure brain modules are registered
initializeBrain();

/**
 * Stream a response for a user message within a conversation.
 *
 * Pipeline:
 * 1. Save user message
 * 2. Gather brain context (memories, etc.)
 * 3. Build full prompt with context
 * 4. Stream AI response
 * 5. Save assistant message + usage
 * 6. Notify brain modules (memory extraction, etc.)
 * 7. Auto-generate title on first exchange
 */
export async function* streamResponse(params: {
  conversationId: string;
  userMessageContent: string;
  membership: MembershipContext;
}): AsyncGenerator<StreamChunk> {
  const { conversationId, userMessageContent, membership } = params;
  const model = AI_CONFIG.defaultModel;
  const provider = getAIProvider();

  // 1. Save user message
  await prisma.message.create({
    data: {
      conversationId,
      role: "USER",
      content: userMessageContent,
    },
  });

  // 2. Gather brain module contexts
  const brainContexts = await gatherBrainContext({
    organizationId: membership.organizationId,
    userId: membership.userId,
    conversationId,
    latestMessage: userMessageContent,
  });

  // 3. Build context with brain modules injected
  const messages = await buildContext({
    conversationId,
    newMessage: userMessageContent,
    membership,
    moduleContexts: brainContexts,
  });

  // 4. Stream from AI provider
  const startTime = Date.now();
  let fullContent = "";

  try {
    for await (const chunk of provider.streamCompletion({
      model,
      messages,
      temperature: AI_CONFIG.temperature,
      maxTokens: AI_CONFIG.maxOutputTokens,
    })) {
      if (chunk.type === "text") {
        fullContent += chunk.content;
        yield { type: "text", content: chunk.content };
      }

      if (chunk.type === "finish" && chunk.usage) {
        const durationMs = Date.now() - startTime;

        // 5. Save assistant message
        const assistantMessage = await prisma.message.create({
          data: {
            conversationId,
            role: "ASSISTANT",
            content: fullContent,
            model,
            inputTokens: chunk.usage.inputTokens,
            outputTokens: chunk.usage.outputTokens,
            durationMs,
          },
        });

        await recordUsage({
          organizationId: membership.organizationId,
          userId: membership.userId,
          conversationId,
          model,
          usage: chunk.usage,
        });

        await prisma.conversation.update({
          where: { id: conversationId },
          data: { updatedAt: new Date() },
        });

        // 6. Notify brain modules (fire-and-forget)
        processExchange({
          organizationId: membership.organizationId,
          userId: membership.userId,
          conversationId,
          userMessage: userMessageContent,
          assistantMessage: fullContent,
          membership,
        }).catch((_err) => {
          // Brain post-processing is non-critical
        });

        // 7. Auto-title on first exchange
        const messageCount = await prisma.message.count({
          where: { conversationId },
        });
        if (messageCount <= 2) {
          generateTitle(userMessageContent)
            .then((title) =>
              prisma.conversation.update({
                where: { id: conversationId },
                data: { title },
              })
            )
            .catch(() => {});
        }

        yield {
          type: "done",
          messageId: assistantMessage.id,
          usage: chunk.usage,
        };
      }
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "AI response failed";
    console.error("AI stream error:", message);
    yield { type: "error", content: message };
  }
}

/**
 * Auto-generate a title for a conversation.
 */
export async function generateTitle(firstMessage: string): Promise<string> {
  try {
    const provider = getAIProvider();
    const { content } = await provider.complete({
      model: AI_CONFIG.titleGenerationModel,
      messages: [
        { role: "system", content: TITLE_GENERATION_PROMPT },
        { role: "user", content: firstMessage },
      ],
      temperature: 0.3,
      maxTokens: AI_CONFIG.titleMaxTokens,
    });
    return content.trim().slice(0, 100) || "New conversation";
  } catch (_error) {
    return "New conversation";
  }
}
