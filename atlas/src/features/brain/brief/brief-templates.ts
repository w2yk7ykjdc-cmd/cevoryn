import "server-only";

import type { PulseMetrics, BriefSection } from "../core/types";

export function buildBriefPrompt(params: {
  orgName: string;
  type: "DAILY" | "WEEKLY";
  pulseMetrics: PulseMetrics;
  recentMemories: string[];
  activeInsights: string[];
  conversationExcerpts: string[];
}): string {
  const periodLabel = params.type === "DAILY" ? "today" : "this week";

  return `You are Atlas, preparing a ${params.type.toLowerCase()} briefing for the leadership of "${params.orgName}".

## Data Available

### Activity Metrics (${periodLabel})
- Conversations: ${params.pulseMetrics.conversationCount}
- Messages exchanged: ${params.pulseMetrics.messageCount}
- Active team members: ${params.pulseMetrics.activeUserCount}
- Avg response time: ${params.pulseMetrics.avgResponseTimeMs}ms
- Tokens used: ${params.pulseMetrics.tokenUsage.total.toLocaleString()}

### Company Knowledge
${params.recentMemories.length > 0 ? params.recentMemories.map((m) => `- ${m}`).join("\n") : "No stored memories yet."}

### Active Insights
${params.activeInsights.length > 0 ? params.activeInsights.map((i) => `- ${i}`).join("\n") : "No active insights."}

### Recent Conversation Themes
${params.conversationExcerpts.length > 0 ? params.conversationExcerpts.join("\n") : "No recent conversations."}

## Instructions
Generate a concise, actionable briefing with these sections:
1. **Executive Summary** (2-3 sentences)
2. **Key Highlights** (what went well)
3. **Needs Attention** (items requiring action)
4. **Priorities** (recommended focus areas)

For each section, assign priority: "high", "medium", or "low".

Respond with ONLY a JSON array of sections. No markdown, no explanation.
Format: [{"heading":"Executive Summary","content":"...","priority":"high"}]`;
}

export function buildFallbackBrief(
  type: "DAILY" | "WEEKLY",
  metrics: PulseMetrics
): BriefSection[] {
  const periodLabel = type === "DAILY" ? "Today" : "This week";

  return [
    {
      heading: "Executive Summary",
      content: `${periodLabel}, the team had ${metrics.conversationCount} conversation${metrics.conversationCount === 1 ? "" : "s"} with ${metrics.messageCount} message${metrics.messageCount === 1 ? "" : "s"} across ${metrics.activeUserCount} active team member${metrics.activeUserCount === 1 ? "" : "s"}.`,
      priority: "medium",
    },
    {
      heading: "Activity",
      content: `Total token usage: ${metrics.tokenUsage.total.toLocaleString()}. Average AI response time: ${metrics.avgResponseTimeMs}ms.`,
      priority: "low",
    },
  ];
}
