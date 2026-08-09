import "server-only";

import { streamResponse } from "@/features/ai/engine/conversation-engine";
import { releaseAiTokenReservation } from "@/server/services/entitlement.service";
import { checkRateLimit } from "@/server/services/rate-limit.service";
import type { MembershipContext, StreamChunk } from "@/types";

/**
 * Send a message and get a streaming AI response.
 *
 * This is the single entry point for the API route.
 * It enforces rate limits before delegating to the engine.
 */
export async function* sendMessage(params: {
  conversationId: string;
  content: string;
  membership: MembershipContext;
  reservationId: string;
}): AsyncGenerator<StreamChunk> {
  // Rate limit check
  const rateLimit = await checkRateLimit(params.membership.organizationId);
  if (!rateLimit.allowed) {
    // The reservation was made before this check ran and streamResponse
    // never got a chance to reconcile or release it — do that here so a
    // rate-limited request doesn't permanently eat into the org's budget.
    await releaseAiTokenReservation(params.reservationId);
    yield {
      type: "error",
      content: `Daily token limit reached (${rateLimit.dailyLimit.toLocaleString()} tokens). Resets at midnight.`,
    };
    return;
  }

  // Delegate to engine
  yield* streamResponse({
    conversationId: params.conversationId,
    userMessageContent: params.content,
    membership: params.membership,
    reservationId: params.reservationId,
  });
}
