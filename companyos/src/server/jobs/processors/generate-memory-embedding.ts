import { upsertMemory } from "@/server/ai/memory/long-term";
import type { JobPayload } from "@/server/jobs/types";

export async function generateMemoryEmbeddingProcessor(
  data: JobPayload<"generate-memory-embedding">,
): Promise<void> {
  await upsertMemory({
    organizationId: data.organizationId,
    userId: data.userId,
    conversationId: data.conversationId,
    kind: data.kind,
    content: data.content,
  });
}
