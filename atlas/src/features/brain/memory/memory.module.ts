import "server-only";

import type {
  BrainContextParams,
  BrainExchangeParams,
  BrainModule,
} from "../core/types";

import { extractMemories } from "./memory-extractor";
import { getMemoriesForContext } from "./memory.service";

/**
 * Memory module — provides company knowledge to the AI and
 * extracts new memories from conversations.
 */
export class MemoryModule implements BrainModule {
  readonly name = "memory";

  async getContext(params: BrainContextParams): Promise<string> {
    const memories = await getMemoriesForContext(params.organizationId);

    if (memories.length === 0) return "";

    const lines = memories.map(
      (m: { category: string; content: string }) =>
        `- [${m.category}] ${m.content}`
    );

    return `## Company Knowledge\nThe following facts are known about this organization:\n${lines.join("\n")}`;
  }

  async afterExchange(params: BrainExchangeParams): Promise<void> {
    await extractMemories(params);
  }
}
