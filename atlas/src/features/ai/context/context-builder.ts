import "server-only";

import { AI_CONFIG } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import type { ChatMessage, MembershipContext } from "@/types";

import { buildSystemPrompt } from "./prompts";

/**
 * Build the full message array for the AI provider.
 *
 * Strategy:
 * 1. System prompt with organization, user, memory, and active-work context
 * 2. Conversation history (trimmed to budget)
 * 3. The new user message
 *
 * Extension point: `moduleContexts` allows future modules to inject
 * their own context (e.g. recent tasks, upcoming meetings).
 */
export async function buildContext(params: {
  conversationId: string;
  newMessage: string;
  membership: MembershipContext;
  moduleContexts?: string[];
}): Promise<ChatMessage[]> {
  const { conversationId, newMessage, membership, moduleContexts = [] } = params;
  const orgId = membership.organizationId;

  const [memberCount, memories, insights, decisions, historyMessages] =
    await Promise.all([
      prisma.member.count({ where: { organizationId: orgId } }),
      prisma.memory.findMany({
        where: { organizationId: orgId, isActive: true },
        orderBy: [{ confidence: "desc" }, { updatedAt: "desc" }],
        take: 12,
        select: {
          category: true,
          content: true,
          confidence: true,
        },
      }),
      prisma.insight.findMany({
        where: { organizationId: orgId, status: "NEW" },
        orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
        take: 5,
        select: {
          title: true,
          summary: true,
          severity: true,
          recommendedAction: true,
          confidence: true,
        },
      }),
      prisma.decision.findMany({
        where: {
          organizationId: orgId,
          status: { in: ["PROPOSED", "ACCEPTED", "EXECUTED"] },
        },
        orderBy: [{ priorityScore: "desc" }, { updatedAt: "desc" }],
        take: 5,
        select: {
          status: true,
          priorityScore: true,
          canvas: true,
        },
      }),
      prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: "desc" },
        take: AI_CONFIG.maxConversationHistory,
        select: {
          role: true,
          content: true,
        },
      }),
    ]);

  const companyContext = buildCompanyContext(memories, insights, decisions);
  const systemPrompt = buildSystemPrompt(membership, memberCount, [
    companyContext,
    ...moduleContexts,
  ]);

  const history: ChatMessage[] = historyMessages
    .reverse()
    .map((message: { role: string; content: string }) => ({
      role: message.role.toLowerCase() as ChatMessage["role"],
      content: message.content,
    }));

  return [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: newMessage },
  ];
}

function buildCompanyContext(
  memories: Array<{ category: string; content: string; confidence: number }>,
  insights: Array<{
    title: string;
    summary: string;
    severity: string;
    recommendedAction: string;
    confidence: number;
  }>,
  decisions: Array<{
    status: string;
    priorityScore: number;
    canvas: unknown;
  }>
): string {
  const sections: string[] = [
    "## Company Intelligence",
    "Use the information below when it is relevant. Do not claim that missing information exists, and do not treat low-confidence items as confirmed facts.",
  ];

  if (memories.length > 0) {
    sections.push(
      "### Known company context",
      ...memories.map(
        (memory) =>
          `- [${memory.category}, ${Math.round(memory.confidence * 100)}% confidence] ${memory.content}`
      )
    );
  }

  if (insights.length > 0) {
    sections.push(
      "### Open insights",
      ...insights.map((insight) => {
        const summary = insight.summary ? ` — ${insight.summary}` : "";
        const action = insight.recommendedAction
          ? ` Next move: ${insight.recommendedAction}`
          : "";
        return `- [${insight.severity}, ${Math.round(insight.confidence * 100)}% confidence] ${insight.title}${summary}.${action}`;
      })
    );
  }

  if (decisions.length > 0) {
    sections.push(
      "### Active decisions",
      ...decisions.map((decision) => {
        const canvas = asDecisionCanvas(decision.canvas);
        const problem = canvas.problemStatement ?? "Untitled decision";
        const recommendation = canvas.recommendedDecision
          ? ` Recommended direction: ${canvas.recommendedDecision}`
          : "";
        return `- [${decision.status}, priority ${decision.priorityScore}/10] ${problem}.${recommendation}`;
      })
    );
  }

  if (memories.length === 0 && insights.length === 0 && decisions.length === 0) {
    sections.push(
      "No stored company memories, open insights, or active decisions are available yet. Ask for the missing business context before giving company-specific advice."
    );
  }

  return sections.join("\n");
}

function asDecisionCanvas(value: unknown): {
  problemStatement?: string;
  recommendedDecision?: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const record = value as Record<string, unknown>;
  return {
    problemStatement:
      typeof record.problemStatement === "string"
        ? record.problemStatement
        : undefined,
    recommendedDecision:
      typeof record.recommendedDecision === "string"
        ? record.recommendedDecision
        : undefined,
  };
}
