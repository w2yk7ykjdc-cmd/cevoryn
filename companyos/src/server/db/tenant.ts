import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";

/**
 * Every Prisma model that carries an `organizationId` column and therefore
 * needs tenant isolation enforced at the query layer. Keep this list in sync
 * with `prisma/schema.prisma` — any tenant-scoped model left out of this set
 * is NOT protected by `getTenantScopedClient` and can leak across tenants.
 */
const TENANT_SCOPED_MODELS = new Set([
  "AuditLog",
  "DomainEvent",
  "ApiKey",
  "Conversation",
  "Message", // scoped indirectly via Conversation, listed for documentation
  "ToolInvocation", // scoped indirectly via Conversation, listed for documentation
  "MemoryRecord",
  "Company",
  "Contact",
  "ContactTag", // scoped indirectly via Contact, listed for documentation
  "ContactNote", // scoped indirectly via Contact, listed for documentation
  "Tag",
  "PipelineStage",
  "Lead",
  "LeadActivity",
  "Task",
  "AgentRun",
  "AgentStep", // scoped indirectly via AgentRun, listed for documentation
  "AgentApproval",
  "Subscription",
  "UsageRecord",
  "CompanySignal",
]);

const DIRECTLY_SCOPED_MODELS = new Set([
  "AuditLog",
  "DomainEvent",
  "ApiKey",
  "Conversation",
  "MemoryRecord",
  "Company",
  "Contact",
  "Tag",
  "PipelineStage",
  "Lead",
  "LeadActivity",
  "Task",
  "AgentRun",
  "AgentApproval",
  "Subscription",
  "UsageRecord",
  "CompanySignal",
]);

export class CrossTenantAccessError extends Error {
  constructor(model: string) {
    super(`Attempted to access "${model}" outside of its owning organization`);
    this.name = "CrossTenantAccessError";
  }
}

/**
 * Returns a Prisma Client scoped to a single organization: every read/write
 * against a directly tenant-scoped model automatically gets
 * `organizationId: organizationId` merged into its `where` clause, and any
 * attempt to explicitly query a *different* organizationId throws instead of
 * silently overriding it. This is defense-in-depth, not the only guard —
 * application code should still pass `organizationId` explicitly — but it
 * ensures a missed filter fails closed rather than leaking data cross-tenant.
 *
 * Use this for all request-scoped tenant data access. Use the raw `prisma`
 * export only for auth/session plumbing (Better Auth manages its own
 * tables) and for genuinely cross-tenant admin operations.
 */
export function getTenantScopedClient(organizationId: string) {
  return prisma.$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !DIRECTLY_SCOPED_MODELS.has(model)) {
            return query(args);
          }

          const scopableOps = new Set([
            "findMany",
            "findFirst",
            "findFirstOrThrow",
            "findUnique",
            "findUniqueOrThrow",
            "update",
            "updateMany",
            "delete",
            "deleteMany",
            "count",
            "aggregate",
            "groupBy",
          ]);

          if (scopableOps.has(operation)) {
            const where = (args as { where?: Record<string, unknown> }).where ?? {};
            if (
              "organizationId" in where &&
              where.organizationId !== undefined &&
              where.organizationId !== organizationId
            ) {
              throw new CrossTenantAccessError(model);
            }
            (args as { where?: Record<string, unknown> }).where = {
              ...where,
              organizationId,
            };
          }

          if (operation === "create") {
            const data = (args as { data?: Record<string, unknown> }).data ?? {};
            if (
              "organizationId" in data &&
              data.organizationId !== undefined &&
              data.organizationId !== organizationId
            ) {
              throw new CrossTenantAccessError(model);
            }
            (args as { data?: Record<string, unknown> }).data = {
              ...data,
              organizationId,
            };
          }

          if (operation === "createMany") {
            const data = (args as { data?: Record<string, unknown>[] }).data ?? [];
            (args as { data?: Record<string, unknown>[] }).data = data.map((row) => ({
              ...row,
              organizationId,
            }));
          }

          return query(args);
        },
      },
    },
  });
}

export type TenantScopedClient = ReturnType<typeof getTenantScopedClient>;
export { TENANT_SCOPED_MODELS };
export type { Prisma };
