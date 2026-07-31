import { z } from "zod";
import { registerTool } from "@/server/ai/tools/registry";
import { upsertMemory } from "@/server/ai/memory/long-term";

const schema = z.object({
  content: z.string().min(1).max(2000).describe("The fact or preference to remember, written as a standalone statement."),
  kind: z.enum(["fact", "preference", "summary"]).default("fact"),
});

registerTool({
  name: "remember_fact",
  description:
    "Store a fact or user preference in long-term memory so it can be recalled in future conversations.",
  schema,
  requiredPermission: { aiTool: ["execute"] },
  async handler(input, ctx) {
    const id = await upsertMemory({
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      conversationId: ctx.conversationId,
      kind: input.kind,
      content: input.content,
    });
    return { stored: true, memoryId: id };
  },
});
