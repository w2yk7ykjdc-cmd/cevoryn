import type { ProviderId, TokenUsage } from "@/server/ai/providers/types";
import type { ToolExecutionResult } from "@/server/ai/tools/types";

export type RunConversationInput = {
  organizationId: string;
  userId: string;
  conversationId: string;
  userMessage: string;
  requestHeaders: Headers;
  provider?: ProviderId;
  model?: string;
  maxToolRounds?: number;
  maxContextTokens?: number;
};

export type ToolRoundLog = {
  toolName: string;
  input: unknown;
  result: ToolExecutionResult;
};

export type RunConversationResult = {
  content: string;
  toolRounds: ToolRoundLog[];
  usage: TokenUsage;
};
