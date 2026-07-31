import { z } from "zod";
import { registerTool } from "@/server/ai/tools/registry";
import { searchMemory } from "@/server/ai/memory/long-term";

const schema = z.object({
  query: z.string().min(1).max(500).describe("What to recall from long-term memory."),
  limit: z.number().int().min(1).max(20).default(5),
});

registerTool({
  name: "search_memory",
  description: "Search previously remembered facts, preferences, and summaries relevant to a query.",
  schema,
  requiredPermission: { aiTool: ["execute"] },
  async handler(input, ctx) {
    const results = await searchMemory({
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      query: input.query,
      limit: input.limit,
    });
    return {
      results: results.map((r) => ({
        content: r.content,
        kind: r.kind,
        relevance: r.distance !== undefined ? 1 - r.distance / 2 : undefined,
      })),
    };
  },
});
