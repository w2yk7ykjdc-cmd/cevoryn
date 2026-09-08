import { z } from "zod";
import { registerTool } from "@/server/ai/tools/registry";
import { listOutcomes } from "@/server/intelligence/outcome/service";
import { recordAuditLog } from "@/server/audit/audit-log";

const schema = z.object({
  evaluationStatus: z
    .enum(["pending", "evaluated", "insufficient_evidence"])
    .optional()
    .describe("Filter to outcomes in this evaluation status. Omit to return outcomes in any status."),
  relatedEntityType: z
    .enum(["Opportunity", "Risk", "AutonomousActionLog"])
    .optional()
    .describe("Filter to outcomes about this kind of subject. Omit to return outcomes for any subject."),
  limit: z.number().int().min(1).max(50).optional().describe("Max outcomes to return. Defaults to 20."),
});

/**
 * Read-only — surfaces already-determined outcome data, never decides it.
 * The evaluation itself always comes from `resolveOutcomeDecision`-style
 * deterministic rules or an explicit human confirmation
 * (`outcome:confirm`), neither of which this tool can trigger; this tool
 * cannot mark, evaluate, or confirm anything, by design (see the `Outcome`
 * model's own schema doc comment on why an LLM is never ground truth).
 */
registerTool({
  name: "get_outcomes",
  description:
    "List recorded outcomes -- what actually happened after a Decision, Opportunity, Risk, or autonomous " +
    "action. Each outcome includes its evaluation status (pending/evaluated/insufficient_evidence), its " +
    "classification once evaluated (success/failure/neutral/expired/reversed/unknown), confidence, and " +
    "evidence. Use this to answer questions about whether past recommendations or autonomous actions " +
    "actually worked out.",
  schema,
  requiredPermission: { outcome: ["read"] },
  domain: "crm",
  mutationCategory: "read_only",
  async handler(input, ctx) {
    await recordAuditLog({
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      actorType: "ai",
      action: "outcome.ai_viewed",
      targetType: "organization",
      targetId: ctx.organizationId,
      metadata: { conversationId: ctx.conversationId },
    });

    const { outcomes } = await listOutcomes({
      organizationId: ctx.organizationId,
      evaluationStatus: input.evaluationStatus,
      relatedEntityType: input.relatedEntityType,
      limit: input.limit ?? 20,
    });

    return {
      outcomes: outcomes.map((o) => ({
        id: o.id,
        relatedEntityType: o.relatedEntityType,
        relatedEntityId: o.relatedEntityId,
        ruleName: o.ruleName,
        ruleVersion: o.ruleVersion,
        evaluationStatus: o.evaluationStatus,
        outcomeType: o.outcomeType,
        source: o.source,
        confidence: o.confidence,
        value: o.value !== null ? Number(o.value) : null,
        observationDueAt: o.observationDueAt ? o.observationDueAt.toISOString() : null,
        observedAt: o.observedAt ? o.observedAt.toISOString() : null,
        createdAt: o.createdAt.toISOString(),
      })),
    };
  },
});
