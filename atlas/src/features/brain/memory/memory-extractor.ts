import "server-only";

import { prisma } from "@/lib/prisma";
import { getAIProvider } from "@/features/ai/providers";
import { AI_CONFIG } from "@/lib/constants";

import type { BrainExchangeParams } from "../core/types";
import type { CreateMemoryInput } from "./schemas";
import { createMemory } from "./memory.service";

const EXTRACTION_PROMPT = `You are analyzing a conversation exchange between a user and Atlas AI.
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
          content: `User said: "${userMessage}"\n\nAtlas replied: "${assistantMessage}"`,
        },
      ],
      temperature: 0.2,
      maxTokens: 500,
    });

    const cleaned = content.trim();
    if (!cleaned || cleaned === "[]") return;

    let extracted: Array<{ category: string; content: string }>;
    try {
      extracted = JSON.parse(cleaned);
    } catch (_parseError) {
      return;
    }

    if (!Array.isArray(extracted) || extracted.length === 0) return;

    const validCategories = new Set([
      "DECISION",
      "PREFERENCE",
      "TEAM_DYNAMIC",
      "PROJECT_STATUS",
      "PROCESS",
      "GOAL",
      "FACT",
    ]);

    for (const item of extracted) {
      if (
        typeof item.content !== "string" ||
        item.content.length < 5 ||
        !validCategories.has(item.category)
      ) {
        continue;
      }

      // Check for duplicate content
      const existing = await prisma.memory.findFirst({
        where: {
          organizationId,
          content: { equals: item.content, mode: "insensitive" },
          isActive: true,
        },
        select: { id: true },
      });

      if (existing) continue;

      await createMemory(
        organizationId,
        {
          category: item.category as CreateMemoryInput["category"],
          content: item.content,
        },
        "CONVERSATION",
        conversationId
      );
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "unknown";
    console.error(`Memory extraction failed: ${msg}`);
  }
}
