import "server-only";

import { getAIProvider } from "@/features/ai/providers";
import { AI_CONFIG } from "@/lib/constants";
import { toActionType } from "@/lib/enum-validators";

import { createPreparedAction } from "./action.service";

const ACTION_GENERATION_PROMPT = `You are Atlas, a Management Intelligence Platform. Based on the insight provided, prepare concrete actions the user can take.

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

interface RawAction {
  type: string;
  title: string;
  description: string;
  content: Record<string, unknown>;
}

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
  const validTypes = new Set([
    "EMAIL_DRAFT",
    "TASK",
    "CALENDAR_PROPOSAL",
    "FOLLOW_UP",
  ]);

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

    let actions: RawAction[];
    try {
      actions = JSON.parse(content.trim());
    } catch (_parseError) {
      return 0;
    }

    if (!Array.isArray(actions)) return 0;

    let created = 0;
    for (const action of actions.slice(0, 3)) {
      if (!action.title || !validTypes.has(action.type)) continue;

      await createPreparedAction({
        organizationId: params.organizationId,
        type: toActionType(action.type) ?? "TASK",
        title: action.title,
        description: action.description || "",
        content: action.content || {},
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
