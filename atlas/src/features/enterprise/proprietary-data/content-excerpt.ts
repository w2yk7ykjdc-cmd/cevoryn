/**
 * Shared truncation for injecting a ProprietaryDataRecord's content into a
 * prompt - content can be up to 20,000 chars (see
 * createProprietaryDataRecordSchema), and every context this gets injected
 * into (chat system prompt, Opportunity generation prompt) has a bounded
 * token budget an unbounded record must never be allowed to dominate.
 * Single source of truth so the chat Brain module and the Opportunity
 * generator can't silently drift to different limits.
 *
 * Deliberately has no "server-only" import and no DB dependency, unlike
 * proprietary-data.service.ts - it's pure string manipulation, so it stays
 * directly unit-testable via plain `npm test`, matching the same
 * "testable without server-only AI/DB dependencies" convention
 * opportunity-generation-math.ts and event-extraction-math.ts already use.
 */

const DEFAULT_EXCERPT_LENGTH = 500;

export function excerptProprietaryContent(
  content: string,
  maxLength: number = DEFAULT_EXCERPT_LENGTH
): string {
  return content.length > maxLength
    ? `${content.slice(0, maxLength)}…`
    : content;
}
