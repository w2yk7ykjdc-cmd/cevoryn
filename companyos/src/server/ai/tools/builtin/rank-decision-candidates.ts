import { z } from "zod";
import { registerTool } from "@/server/ai/tools/registry";
import { getDecisionIntelligenceSnapshot } from "@/server/intelligence/decision-intelligence/service";

const schema = z.object({});

/**
 * Read-only, deterministic ranking of every currently-open Risk and active
 * Opportunity, ordered by a historical-performance-adjusted priority score
 * with an explicit, DB-derived explanation per candidate
 * (`rankingReasons`). This tool cannot generate its own ranking rationale
 * or override the returned order -- the LLM may only relay the structured
 * output verbatim, never substitute its own judgment for it (see
 * `rankDecisionCandidates`'s doc comment). Does not write an `AuditLog`
 * entry -- see `get_decision_performance`'s doc comment for why.
 */
registerTool({
  name: "rank_decision_candidates",
  description:
    "Get every currently open Risk and active Opportunity ranked by a deterministic, explainable priority " +
    "score (severity-weighted dollar exposure, adjusted by the candidate's own confidence and this " +
    "organization's historical success rate for that candidate type). Also returns Sprint 8's current " +
    "single top-priority Decision for comparison. Each ranked candidate includes rankingReasons explaining " +
    "the score in plain language, derived entirely from real evaluated outcome data -- never from an LLM " +
    "judgment. Ranking is advisory only: it cannot change which Decision CompanyOS has recorded, and it " +
    "cannot change any autonomy policy, allowlist, or permission.",
  schema,
  requiredPermission: { decision: ["read"] },
  domain: "crm",
  mutationCategory: "read_only",
  async handler(_input, ctx) {
    const snapshot = await getDecisionIntelligenceSnapshot(ctx.organizationId);

    return {
      currentDecision: snapshot.currentDecision
        ? {
            recommendation: snapshot.currentDecision.recommendation,
            rationale: snapshot.currentDecision.rationale,
            sourceType: snapshot.currentDecision.sourceType,
            sourceId: snapshot.currentDecision.sourceId,
            priorityScore: Number(snapshot.currentDecision.priorityScore),
          }
        : null,
      rankedCandidates: snapshot.rankedCandidates,
    };
  },
});
