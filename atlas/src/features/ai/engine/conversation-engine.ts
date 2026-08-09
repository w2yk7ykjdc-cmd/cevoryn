import "server-only";

import { initializeBrain } from "@/features/brain/bootstrap";
import {
  gatherBrainContext,
  processExchange,
} from "@/features/brain/core/atlas-engine";
import { AI_CONFIG } from "@/lib/constants";
import { captureServerError } from "@/lib/error-reporting";
import { buildGoogleWorkspacePromptContext } from "@/lib/google-context";
import { prisma } from "@/lib/prisma";
import {
  reconcileAiTokenReservation,
  releaseAiTokenReservation,
} from "@/server/services/entitlement.service";
import type { MembershipContext, StreamChunk } from "@/types";

import { buildContext } from "../context/context-builder";
import { TITLE_GENERATION_PROMPT } from "../context/prompts";
import { getAIProvider } from "../providers";

import { tryCreateGoogleDraftFromChat } from "./chat-google-draft";

// Ensure brain modules are registered
initializeBrain();

/**
 * Stream a response for a user message within a conversation.
 *
 * Pipeline:
 * 1. Save user message
 * 2. Execute an explicitly requested Gmail draft action when complete
 * 3. Gather brain and connected-workspace context
 * 4. Build full prompt with context
 * 5. Stream AI response
 * 6. Save assistant message + usage
 * 7. Notify brain modules (memory extraction, etc.)
 * 8. Auto-generate title on first exchange
 */
export async function* streamResponse(params: {
  conversationId: string;
  userMessageContent: string;
  membership: MembershipContext;
  reservationId: string;
}): AsyncGenerator<StreamChunk> {
  const { conversationId, userMessageContent, membership, reservationId } =
    params;
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

  // 2. A direct request to create a Gmail draft is itself explicit approval for
  // draft creation only. Never send email, and never invent missing fields.
  try {
    const draftAction = await tryCreateGoogleDraftFromChat({
      message: userMessageContent,
      organizationId: membership.organizationId,
      userId: membership.userId,
      provider,
    });

    if (draftAction) {
      const assistantMessage = await prisma.message.create({
        data: {
          conversationId,
          role: "ASSISTANT",
          content: draftAction.content,
          model,
          inputTokens: draftAction.usage.inputTokens,
          outputTokens: draftAction.usage.outputTokens,
          durationMs: 0,
        },
      });

      await reconcileAiTokenReservation(reservationId, draftAction.usage);

      await prisma.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });

      yield { type: "text", content: draftAction.content };
      yield {
        type: "done",
        messageId: assistantMessage.id,
        usage: draftAction.usage,
      };
      return;
    }
  } catch (error) {
    await releaseAiTokenReservation(reservationId);
    const message =
      error instanceof Error
        ? error.message
        : "The Gmail draft could not be created";
    const content = `Gmail taslağı oluşturulamadı: ${message}`;
    const assistantMessage = await prisma.message.create({
      data: {
        conversationId,
        role: "ASSISTANT",
        content,
        model,
      },
    });
    yield { type: "text", content };
    yield { type: "done", messageId: assistantMessage.id };
    return;
  }

  // 3. Gather context sources in parallel. Google data is optional and must
  // never prevent chat from working when no account is connected.
  const [brainContexts, googleContext] = await Promise.all([
    gatherBrainContext({
      organizationId: membership.organizationId,
      userId: membership.userId,
      conversationId,
      latestMessage: userMessageContent,
    }),
    buildGoogleWorkspacePromptContext(
      membership.organizationId,
      membership.userId
    ),
  ]);

  // 4. Build context with optional modules injected
  const moduleContexts = googleContext
    ? [...brainContexts, googleContext]
    : brainContexts;
  const messages = await buildContext({
    conversationId,
    newMessage: userMessageContent,
    membership,
    moduleContexts,
  });

  // 5. Stream from AI provider
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

        // 6. Save assistant message
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

        await reconcileAiTokenReservation(reservationId, chunk.usage);

        await prisma.conversation.update({
          where: { id: conversationId },
          data: { updatedAt: new Date() },
        });

        // 7. Notify brain modules (fire-and-forget)
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

        // 8. Auto-title on first exchange
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
    await releaseAiTokenReservation(reservationId);
    const message =
      error instanceof Error ? error.message : "AI response failed";
    captureServerError("chat-stream", error, {
      organizationId: membership.organizationId,
      conversationId,
    });
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
