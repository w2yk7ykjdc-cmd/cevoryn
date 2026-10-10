import "server-only";

import { streamResponse } from "@/features/ai/engine/conversation-engine";
import type { MembershipContext, StreamChunk } from "@/types";

/**
 * Send a message and get a streaming AI response.
 *
 * This is the single entry point for the API route. Rate limiting
 * (monthly org cap, daily org cap, daily per-user cap) is already
 * enforced atomically by entitlement.service.ts's reserveAiTokenCapacity
 * before the caller obtains `reservationId` - a second check here would
 * be redundant (it can't observe a different outcome moments later) and,
 * being a plain read unlike that atomic reservation, would only
 * reintroduce the check-then-act race the reservation was built to close.
 */
export async function* sendMessage(params: {
  conversationId: string;
  content: string;
  membership: MembershipContext;
  reservationId: string;
}): AsyncGenerator<StreamChunk> {
  yield* streamResponse({
    conversationId: params.conversationId,
    userMessageContent: params.content,
    membership: params.membership,
    reservationId: params.reservationId,
  });
}
