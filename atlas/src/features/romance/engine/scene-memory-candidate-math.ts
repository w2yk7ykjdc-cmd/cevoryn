/**
 * Validates memory candidates a generated scene proposes, before any of
 * them are persisted. Same idiom as
 * src/features/brain/memory/memory-extraction-math.ts::selectValidMemories()
 * - never trust model-generated output directly; filter to recognized
 * types with non-trivial content first.
 */

const VALID_MEMORY_TYPES = new Set([
  "PROMISE",
  "BARGAIN",
  "DEBT",
  "SECRET",
  "RELATIONSHIP_EVENT",
  "USER_FACT",
  "CHARACTER_FACT",
  "WORLD_EVENT",
  "DISCOVERED_TRUTH",
  "ITEM",
  "LOCATION",
  "BETRAYAL",
  "PREFERENCE",
]);

const MIN_CONTENT_LENGTH = 3;
const MAX_CONTENT_LENGTH = 500;

export interface ProposedMemoryCandidate {
  type?: unknown;
  subject?: unknown;
  object?: unknown;
  content?: unknown;
}

export interface ValidatedMemoryCandidate {
  type: string;
  subject: string;
  object: string | null;
  content: string;
}

export function selectValidSceneMemoryCandidates(
  proposed: unknown
): ValidatedMemoryCandidate[] {
  if (!Array.isArray(proposed)) return [];

  const candidates: ValidatedMemoryCandidate[] = [];
  for (const item of proposed as ProposedMemoryCandidate[]) {
    if (
      typeof item?.type !== "string" ||
      !VALID_MEMORY_TYPES.has(item.type) ||
      typeof item?.subject !== "string" ||
      item.subject.trim().length === 0 ||
      typeof item?.content !== "string" ||
      item.content.trim().length < MIN_CONTENT_LENGTH ||
      item.content.length > MAX_CONTENT_LENGTH
    ) {
      continue;
    }

    candidates.push({
      type: item.type,
      subject: item.subject,
      object: typeof item.object === "string" ? item.object : null,
      content: item.content,
    });
  }

  return candidates;
}
