import { z } from "zod";
import { registerTool } from "@/server/ai/tools/registry";
import { listAuditLogs } from "@/server/audit/audit-log";

const schema = z.object({
  action: z.string().optional().describe("Filter by exact audit action, e.g. 'member.role_changed'."),
  limit: z.number().int().min(1).max(50).default(10),
});

registerTool({
  name: "search_audit_log",
  description:
    "Search the organization's audit trail. Requires audit log read access — use this to answer questions like 'who invited this member' or 'when was billing last changed'.",
  schema,
  // Gated on a real organization permission, distinct from the generic
  // aiTool:execute grant every member has — demonstrates permission-scoped
  // tool access rather than all-or-nothing tool availability.
  requiredPermission: { auditLog: ["read"] },
  domain: "crm",
  mutationCategory: "read_only",
  async handler(input, ctx) {
    const { entries } = await listAuditLogs({
      organizationId: ctx.organizationId,
      action: input.action,
      limit: input.limit,
    });
    return {
      entries: entries.map((e) => ({
        action: e.action,
        targetType: e.targetType,
        targetId: e.targetId,
        actorId: e.actorId,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  },
});
