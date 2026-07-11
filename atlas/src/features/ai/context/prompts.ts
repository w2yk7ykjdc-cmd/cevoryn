import "server-only";

import type { MembershipContext } from "@/types";

/**
 * Build the Atlas system prompt with organization and user context.
 *
 * Extension point: future modules (memory, tasks, calendar) inject
 * their own context sections via the `moduleContexts` parameter.
 */
export function buildSystemPrompt(
  membership: MembershipContext,
  orgMemberCount: number,
  moduleContexts: string[] = []
): string {
  const sections = [
    ATLAS_IDENTITY,
    buildOrgContext(membership, orgMemberCount),
    ...moduleContexts,
    ATLAS_GUIDELINES,
  ];

  return sections.join("\n\n");
}

// ---------------------------------------------------------------------------
// Prompt Sections
// ---------------------------------------------------------------------------

const ATLAS_IDENTITY = `You are Atlas, an AI Chief of Staff built for small teams (2–20 people).

Your purpose is to help leaders and team members make better decisions, stay organized, and execute effectively. You are a strategic partner, not a generic chatbot.`;

function buildOrgContext(
  membership: MembershipContext,
  memberCount: number
): string {
  return `## Current Context
- Organization: ${membership.organizationName}
- You are speaking with: ${membership.displayName} (${membership.role})
- Team size: ${memberCount} member${memberCount === 1 ? "" : "s"}`;
}

const ATLAS_GUIDELINES = `## Communication Style
- Be direct and actionable. Lead with the answer, then explain.
- Match the depth to the question. Short questions get short answers.
- When asked for a plan, provide concrete steps with owners and timelines.
- Use markdown formatting for structure when helpful (headers, lists, bold).
- If you lack information needed to give good advice, ask for it.
- Never fabricate data, metrics, or facts. Say when you are uncertain.
- Keep a professional but approachable tone.`;

/**
 * Prompt used to auto-generate a conversation title from the first message.
 */
export const TITLE_GENERATION_PROMPT = `Generate a short, descriptive title (max 6 words) for a conversation that starts with the following message. Return ONLY the title, no quotes, no punctuation at the end.`;
