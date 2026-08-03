import "server-only";

import { getAIProvider } from "@/features/ai/providers";
import { AI_CONFIG } from "@/lib/constants";
import { prisma } from "@/lib/prisma";

import { selectActionCandidates } from "./action-preparation-math";
import { createPreparedAction } from "./action.service";

const ACTION_GENERATION_PROMPT = `You are CEVORYN, a Management Intelligence Platform. Based on the insight provided, prepare concrete actions the user can take.

Action types:
- EMAIL_DRAFT: Draft an email to someone. Content: { to: string, subject: string, body: string }
- TASK: Create a task/todo. Content: { title: string, description: string, dueDate: string }
- CALENDAR_PROPOSAL: Suggest a meeting. Content: { title: string, description: string, duration: string, suggestedDate: string }
- FOLLOW_UP: Schedule a follow-up. Content: { with: string, topic: string, suggestedDate: string }

Rules:
- Each action must be specific and immediately actionable.
- Include realistic content, not placeholders.
- Maximum 3 actions per insight.
- These are PROPOSALS — the user must approve before execution.

Respond with ONLY a JSON array. No markdown.
Format: [{"type":"EMAIL_DRAFT","title":"...","description":"...","content":{"to":"...","subject":"...","body":"..."}}]`;

/**
 * Generate prepared actions from an insight.
 * Actions are created with PENDING status — never auto-executed.
 */
export async function prepareActionsFromInsight(params: {
  organizationId: string;
  insightId: string;
  insightTitle: string;
  insightDescription: string;
  insightRecommendedAction: string;
  confidence: number;
}): Promise<number> {
  try {
    const provider = getAIProvider();
    const { content } = await provider.complete({
      model: AI_CONFIG.defaultModel,
      messages: [
        { role: "system", content: ACTION_GENERATION_PROMPT },
        {
          role: "user",
          content: `Insight: "${params.insightTitle}"\nDescription: ${params.insightDescription}\nRecommended action: ${params.insightRecommendedAction}`,
        },
      ],
      temperature: 0.4,
      maxTokens: 1000,
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(content.trim());
    } catch (_parseError) {
      return 0;
    }

    const candidates = selectActionCandidates(parsed);

    let created = 0;

    for (const candidate of candidates) {
      const existing = await prisma.preparedAction.findFirst({
        where: {
          organizationId: params.organizationId,
          sourceInsightId: params.insightId,
          type: candidate.type,
          title: candidate.title,
          status: "PENDING",
        },
        select: { id: true },
      });

      if (existing) continue;

      await createPreparedAction({
        organizationId: params.organizationId,
        type: candidate.type,
        title: candidate.title,
        description: candidate.description,
        content: candidate.content,
        sourceInsightId: params.insightId,
        confidence: params.confidence,
        reasoning: `Generated from insight: "${params.insightTitle}"`,
      });

      created++;
    }

    return created;
  } catch (error) {
    const msg = error instanceof Error ? error.message : "unknown";
    console.error(`Action preparation failed: ${msg}`);
    return 0;
  }
}
