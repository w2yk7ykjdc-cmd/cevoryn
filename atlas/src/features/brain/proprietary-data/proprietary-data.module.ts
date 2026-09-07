import "server-only";

import { getProprietaryDataForContext } from "@/features/enterprise/proprietary-data/proprietary-data.service";

import type { BrainContextParams, BrainModule } from "../core/types";

/**
 * Proprietary Data module — gives the AI system prompt access to the
 * organization's own declared knowledge (manually added today via
 * Settings > Proprietary Data), alongside Memory's chat-derived context.
 * Read-only from the chat pipeline's perspective: unlike MemoryModule,
 * this has no afterExchange hook, since records are only ever added
 * explicitly through the settings UI, never extracted from conversation.
 */
export class ProprietaryDataModule implements BrainModule {
  readonly name = "proprietary-data";

  async getContext(params: BrainContextParams): Promise<string> {
    const records = await getProprietaryDataForContext(params.organizationId);

    if (records.length === 0) return "";

    // Excerpted, not the full record - content can be up to 20,000 chars
    // (see createProprietaryDataRecordSchema) and this context is injected
    // into every chat turn's system prompt, so an unbounded record must
    // never be allowed to dominate the token budget. Matches the same
    // excerpting convention research-worker.ts already uses for signal
    // content in its own prompt.
    const CONTENT_EXCERPT_LENGTH = 500;
    const lines = records.map((record) => {
      const excerpt =
        record.content.length > CONTENT_EXCERPT_LENGTH
          ? `${record.content.slice(0, CONTENT_EXCERPT_LENGTH)}…`
          : record.content;
      return `- [${record.sourceKind}] ${record.title}: ${excerpt}`;
    });

    return `## Proprietary Data (organization's own knowledge)\nThe following records were declared directly by this organization - treat them as authoritative company knowledge, not external signals:\n${lines.join("\n")}`;
  }
}
