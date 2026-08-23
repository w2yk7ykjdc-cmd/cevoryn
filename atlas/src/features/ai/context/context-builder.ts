import "server-only";

import { AI_CONFIG } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import type { ChatMessage, MembershipContext } from "@/types";

import { buildSystemPrompt } from "./prompts";

const STATUS_WINDOW_DAYS = 7;

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
  const {
    conversationId,
    newMessage,
    membership,
    moduleContexts = [],
  } = params;
  const orgId = membership.organizationId;
  const now = new Date();
  const statusWindowStart = new Date(
    now.getTime() - STATUS_WINDOW_DAYS * 24 * 60 * 60 * 1000
  );

  const [
    memberCount,
    memories,
    insights,
    decisions,
    historyMessages,
    recentUsage,
    recentMessageCount,
    responseTime,
    conversationCount,
  ] = await Promise.all([
    prisma.member.count({ where: { organizationId: orgId } }),
    prisma.memory.findMany({
      where: { organizationId: orgId, isActive: true },
      orderBy: [{ confidence: "desc" }, { updatedAt: "desc" }],
      take: 12,
      select: {
        category: true,
        content: true,
        confidence: true,
        updatedAt: true,
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
        createdAt: true,
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
        updatedAt: true,
      },
    }),
    prisma.message.findMany({
      // Defense-in-depth: conversationId alone should already be caller-
      // scoped (the /api/chat route validates it against the session's org
      // + owner before reaching this function), but this join keeps that
      // guarantee true even if a future caller skips that upstream check.
      where: { conversationId, conversation: { organizationId: orgId } },
      orderBy: { createdAt: "desc" },
      take: AI_CONFIG.maxConversationHistory,
      select: {
        role: true,
        content: true,
      },
    }),
    prisma.usageRecord.findMany({
      where: {
        organizationId: orgId,
        createdAt: { gte: statusWindowStart },
      },
      select: {
        userId: true,
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
      },
    }),
    prisma.message.count({
      where: {
        createdAt: { gte: statusWindowStart },
        conversation: { organizationId: orgId },
      },
    }),
    prisma.message.aggregate({
      where: {
        createdAt: { gte: statusWindowStart },
        role: "ASSISTANT",
        durationMs: { not: null },
        conversation: { organizationId: orgId },
      },
      _avg: { durationMs: true },
    }),
    prisma.conversation.count({ where: { organizationId: orgId } }),
  ]);

  const telemetryContext = buildTelemetryContext({
    now,
    windowStart: statusWindowStart,
    memberCount,
    conversationCount,
    recentMessageCount,
    recentUsage,
    averageResponseMs: responseTime._avg.durationMs,
  });
  const companyContext = buildCompanyContext(memories, insights, decisions);
  const systemPrompt = buildSystemPrompt(membership, memberCount, [
    telemetryContext,
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

function buildTelemetryContext(params: {
  now: Date;
  windowStart: Date;
  memberCount: number;
  conversationCount: number;
  recentMessageCount: number;
  recentUsage: Array<{
    userId: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  }>;
  averageResponseMs: number | null;
}): string {
  const activeUsers = new Set(params.recentUsage.map((record) => record.userId))
    .size;
  const tokens = params.recentUsage.reduce(
    (totals, record) => ({
      input: totals.input + record.inputTokens,
      output: totals.output + record.outputTokens,
      total: totals.total + record.totalTokens,
    }),
    { input: 0, output: 0, total: 0 }
  );

  return [
    "## Current Workspace Telemetry (authoritative)",
    `Generated at: ${params.now.toISOString()}`,
    `Measurement window: ${params.windowStart.toISOString()} to ${params.now.toISOString()} (${STATUS_WINDOW_DAYS} days)`,
    `Members: ${params.memberCount}`,
    `Total conversations: ${params.conversationCount}`,
    `Messages in window: ${params.recentMessageCount}`,
    `Active users in window: ${activeUsers}`,
    `Average assistant response time in window: ${
      params.averageResponseMs === null
        ? "not available"
        : `${Math.round(params.averageResponseMs)} ms`
    }`,
    `Token usage in window: input ${tokens.input}, output ${tokens.output}, total ${tokens.total}`,
    "For questions about the current state, status, activity, usage, or performance, use this telemetry before stored memories. State the measurement window. Never present older memories or snapshots as current data.",
  ].join("\n");
}

function buildCompanyContext(
  memories: Array<{
    category: string;
    content: string;
    confidence: number;
    updatedAt: Date;
  }>,
  insights: Array<{
    title: string;
    summary: string;
    severity: string;
    recommendedAction: string;
    confidence: number;
    createdAt: Date;
  }>,
  decisions: Array<{
    status: string;
    priorityScore: number;
    canvas: unknown;
    updatedAt: Date;
  }>
): string {
  const sections: string[] = [
    "## Company Intelligence",
    "The items below are stored context, not live telemetry. Treat them as historical unless their timestamp and content clearly establish that they are current. Do not claim that missing information exists, and do not treat low-confidence items as confirmed facts.",
  ];

  if (memories.length > 0) {
    sections.push(
      "### Known company context",
      ...memories.map(
        (memory) =>
          `- [updated ${memory.updatedAt.toISOString()}, ${memory.category}, ${Math.round(memory.confidence * 100)}% confidence] ${memory.content}`
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
        return `- [created ${insight.createdAt.toISOString()}, ${insight.severity}, ${Math.round(insight.confidence * 100)}% confidence] ${insight.title}${summary}.${action}`;
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
        return `- [updated ${decision.updatedAt.toISOString()}, ${decision.status}, priority ${decision.priorityScore}/10] ${problem}.${recommendation}`;
      })
    );
  }

  if (
    memories.length === 0 &&
    insights.length === 0 &&
    decisions.length === 0
  ) {
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
