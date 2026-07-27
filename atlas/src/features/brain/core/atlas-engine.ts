import "server-only";

import type { MembershipContext } from "@/types";

import { brainRegistry } from "./module-registry";
import type { BrainContextParams, BrainExchangeParams } from "./types";

/**
 * CEVORYN Engine — the central nervous system.
 *
 * Integrates brain modules into the conversation pipeline:
 * 1. Before AI call: gather context from all modules
 * 2. After AI call: notify modules for post-processing
 *
 * This is the single integration point between the chat engine
 * and the brain modules. The chat engine calls these methods;
 * individual modules never interact with the chat engine directly.
 */
export async function gatherBrainContext(params: {
  organizationId: string;
  userId: string;
  conversationId: string;
  latestMessage: string;
}): Promise<string[]> {
  const contextParams: BrainContextParams = {
    organizationId: params.organizationId,
    userId: params.userId,
    conversationId: params.conversationId,
    latestMessage: params.latestMessage,
  };

  return brainRegistry.gatherContext(contextParams);
}

export async function processExchange(params: {
  organizationId: string;
  userId: string;
  conversationId: string;
  userMessage: string;
  assistantMessage: string;
  membership: MembershipContext;
}): Promise<void> {
  const exchangeParams: BrainExchangeParams = {
    organizationId: params.organizationId,
    userId: params.userId,
    conversationId: params.conversationId,
    userMessage: params.userMessage,
    assistantMessage: params.assistantMessage,
    membership: params.membership,
  };

  await brainRegistry.notifyExchange(exchangeParams);
}
