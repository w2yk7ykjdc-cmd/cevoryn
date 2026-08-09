/**
 * Pure extracted-memory validation, split out of memory-extractor.ts so
 * it's testable without that file's server-only AI/DB dependencies.
 */

import { memoryCategories } from "./schemas";
import type { CreateMemoryInput } from "./schemas";

const VALID_CATEGORIES = new Set<string>(memoryCategories);

const MIN_CONTENT_LENGTH = 5;

export interface ExtractedMemoryCandidate {
  category: CreateMemoryInput["category"];
  content: string;
}

/**
 * Filters raw AI-extracted memory items down to ones with a recognized
 * category and non-trivial content, ready to persist.
 */
export function selectValidMemories(
  extracted: unknown
): ExtractedMemoryCandidate[] {
  if (!Array.isArray(extracted)) return [];

  const candidates: ExtractedMemoryCandidate[] = [];
  for (const item of extracted as Array<{
    category?: unknown;
    content?: unknown;
  }>) {
    if (
      typeof item?.content !== "string" ||
      item.content.length < MIN_CONTENT_LENGTH ||
      typeof item?.category !== "string" ||
      !VALID_CATEGORIES.has(item.category)
    ) {
      continue;
    }

    candidates.push({
      category: item.category as CreateMemoryInput["category"],
      content: item.content,
    });
  }

  return candidates;
}
