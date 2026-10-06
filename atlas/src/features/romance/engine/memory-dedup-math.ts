/**
 * Memory write dedup/contradiction resolution - pure. See
 * docs/romance/02-STORY_ENGINE_BIBLE.md §5.4/§5.5. A memory is never
 * "just chat history" and a retried operation must never duplicate a
 * memory row (brief's golden scenario: retry does not duplicate memory).
 */

import type { MemoryCandidate, MemoryLite, MemoryWriteDecision } from "./types";

function normalize(content: string): string {
  return content.trim().toLowerCase().replace(/\s+/g, " ");
}

function sameSignature(a: MemoryLite, b: MemoryCandidate): boolean {
  return (
    a.type === b.type &&
    a.subject === b.subject &&
    (a.object ?? null) === (b.object ?? null)
  );
}

/**
 * Decides what a new memory candidate should do against the session's
 * existing ACTIVE memories:
 *  - identical signature + identical (normalized) content -> SKIP_DUPLICATE
 *    (idempotent retry of the exact same fact)
 *  - identical signature + different content -> SUPERSEDE the existing one
 *    (a contradiction/update, not silently appended alongside the old fact)
 *  - no match -> CREATE
 */
export function resolveMemoryWrite(
  existingActiveMemories: MemoryLite[],
  candidate: MemoryCandidate
): MemoryWriteDecision {
  const candidateContent = normalize(candidate.content);

  for (const existing of existingActiveMemories) {
    if (existing.status !== "ACTIVE") continue;
    if (!sameSignature(existing, candidate)) continue;

    if (normalize(existing.content) === candidateContent) {
      return { action: "SKIP_DUPLICATE", existingId: existing.id };
    }

    return { action: "SUPERSEDE", supersedesId: existing.id };
  }

  return { action: "CREATE" };
}
