import { z } from "zod";
import { registerTool } from "@/server/ai/tools/registry";
import { expireStaleOpportunity } from "@/server/intelligence/opportunity/service";

const schema = z.object({
  opportunityId: z.string().min(1).describe("The id of the opportunity to check and, if stale, expire."),
});

/**
 * Sprint 10's pilot autonomy tool — internal CRM advisory housekeeping
 * only. Marks a single stalled-lead Opportunity as `"expired"` if (and
 * only if) it independently re-verifies the underlying lead is no longer a
 * valid reason to keep the Opportunity open; see
 * `expireStaleOpportunity`'s own doc comment for the exact eligibility
 * rule. The model may only ever pass an id — it never decides staleness,
 * and cannot make the mutation happen by asserting that a record is stale
 * in the input.
 *
 * `autonomyEligible: true` opts this tool into being allowlisted for
 * unattended L4/L5 execution — the ONLY built-in tool with that flag as of
 * Sprint 10. It still requires an organization to explicitly add it to its
 * `AutonomyAllowlistEntry` (owner-only, via `/dashboard/settings/autonomy`)
 * before `resolveAutonomyDecision` will ever let it run without a human
 * approval. `blastRadius: "destructive"` because it modifies an existing
 * record (not a new, additive one) — the correct, honest classification
 * even though it doesn't gate L4/L5 eligibility itself (only `L2`'s
 * approval-queue admission does); this way, if the pilot's allowlist entry
 * is ever removed, the tool correctly falls back to requiring `L3`, not
 * `L2`, to even reach the approval queue. `actionRiskValue: 0` — this
 * action has no monetary exposure by construction, but is still passed
 * explicitly (not omitted) so the real daily/per-action risk-budget
 * arithmetic in `resolveAutonomyDecision` actually runs, proving the
 * mechanism, not just the feature.
 */
registerTool({
  name: "expire_stale_opportunity",
  description:
    "Check a single Opportunity and, if it is provably stale (its underlying lead is now closed, deleted, or " +
    "no longer stalled/high-value), mark it as expired. Does nothing and reports why if the opportunity is not " +
    "eligible — it never overwrites a human's own triage decision, and it is always safe to call more than once.",
  schema,
  requiredPermission: { opportunity: ["update"] },
  domain: "crm",
  mutationCategory: "mutating_gated",
  blastRadius: "destructive",
  autonomyEligible: true,
  actionRiskValue: 0,
  async handler(input, ctx) {
    return expireStaleOpportunity({
      organizationId: ctx.organizationId,
      opportunityId: input.opportunityId,
      actorId: ctx.userId,
    });
  },
});
