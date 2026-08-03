import "server-only";

import { getAIProvider } from "@/features/ai/providers";
import { AI_CONFIG } from "@/lib/constants";
import { prisma } from "@/lib/prisma";

import type { BrainExchangeParams } from "../core/types";

import { selectValidMemories } from "./memory-extraction-math";
import { createMemory } from "./memory.service";

const EXTRACTION_PROMPT = `You are analyzing a conversation exchange between a user and CEVORYN AI.
Extract any important facts, decisions, preferences, goals, team dynamics, project updates, or processes mentioned.

Rules:
- Only extract CONCRETE facts, not vague statements.
- Each memory should be a single, self-contained statement.
- If nothing worth remembering is said, return an empty array.
- Categorize each memory: DECISION, PREFERENCE, TEAM_DYNAMIC, PROJECT_STATUS, PROCESS, GOAL, or FACT.

Respond with ONLY a JSON array of objects with "category" and "content" fields. No markdown, no explanation.
Example: [{"category":"DECISION","content":"Team decided to use PostgreSQL for the new project"}]
If nothing to extract: []`;

/**
 * Extract memories from a conversation exchange.
 * Called asynchronously after each AI response.
 *
 * Uses a lightweight AI call to identify memorable facts.
 * Failures are non-critical — extraction is best-effort.
 */
export async function extractMemories(
  params: BrainExchangeParams
): Promise<void> {
  const { organizationId, conversationId, userMessage, assistantMessage } =
    params;

  try {
    const provider = getAIProvider();

    const { content } = await provider.complete({
      model: AI_CONFIG.titleGenerationModel,
      messages: [
        { role: "system", content: EXTRACTION_PROMPT },
        {
          role: "user",
          content: `User said: "${userMessage}"\n\nCEVORYN replied: "${assistantMessage}"`,
        },
      ],
      temperature: 0.2,
      maxTokens: 500,
    });

    const cleaned = content.trim();
    if (!cleaned || cleaned === "[]") return;

    let extracted: unknown;
    try {
      extracted = JSON.parse(cleaned);
    } catch (_parseError) {
      return;
    }

    const candidates = selectValidMemories(extracted);

    for (const candidate of candidates) {
      // Check for duplicate content
      const existing = await prisma.memory.findFirst({
        where: {
          organizationId,
          content: { equals: candidate.content, mode: "insensitive" },
          isActive: true,
        },
        select: { id: true },
      });

      if (existing) continue;

      await createMemory(
        organizationId,
        candidate,
        "CONVERSATION",
        conversationId
      );
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "unknown";
    console.error(`Memory extraction failed: ${msg}`);
  }
}
