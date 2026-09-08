import { z } from "zod";
import { registerTool } from "@/server/ai/tools/registry";
import { getCandidateTypePerformance, getRulePerformance } from "@/server/intelligence/decision-intelligence/performance";
import { getConfidenceCalibration } from "@/server/intelligence/learning/service";

const schema = z.object({});

/**
 * Read-only. Surfaces already-computed historical performance -- never
 * decides anything, never itself a recommendation. Unlike `get_outcomes`
 * (Sprint 11), this deliberately does NOT write an `AuditLog` entry on
 * every call: Sprint 12's own spec (section 20) calls out that read-only
 * ranking/presentation views should not generate audit noise, reserving
 * `AuditLog` for state-changing actions -- and every function this tool
 * calls is a pure read.
 */
registerTool({
  name: "get_decision_performance",
  description:
    "Get historical performance data behind CompanyOS's decision intelligence: success/failure/reversal rates " +
    "for Opportunity vs Risk candidates, per-evaluation-rule reliability (stale_advisory_resolution, " +
    "risk_resolution, opportunity_state_progression), and confidence calibration (how often a given confidence " +
    "level actually correlates with a positive outcome). All figures are pure database aggregation over " +
    "evaluated Outcome/LearningRecord rows -- never an LLM judgment, never a prediction.",
  schema,
  requiredPermission: { decision: ["read"] },
  domain: "crm",
  mutationCategory: "read_only",
  async handler(_input, ctx) {
    const [candidateTypePerformance, rulePerformance, confidenceCalibration] = await Promise.all([
      getCandidateTypePerformance(ctx.organizationId),
      getRulePerformance(ctx.organizationId),
      getConfidenceCalibration(ctx.organizationId),
    ]);

    return { candidateTypePerformance, rulePerformance, confidenceCalibration };
  },
});
