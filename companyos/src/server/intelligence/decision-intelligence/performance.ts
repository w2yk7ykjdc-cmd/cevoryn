import { getOutcomePerformance } from "@/server/intelligence/learning/service";
import {
  RULE_NAME as STALE_ADVISORY_RULE_NAME,
  RULE_VERSION as STALE_ADVISORY_RULE_VERSION,
} from "@/server/intelligence/outcome/rules/stale-advisory-resolution";
import {
  RULE_NAME as RISK_RESOLUTION_RULE_NAME,
  RULE_VERSION as RISK_RESOLUTION_RULE_VERSION,
} from "@/server/intelligence/outcome/rules/risk-resolution";
import {
  RULE_NAME as OPPORTUNITY_PROGRESSION_RULE_NAME,
  RULE_VERSION as OPPORTUNITY_PROGRESSION_RULE_VERSION,
} from "@/server/intelligence/outcome/rules/opportunity-state-progression";
import { sampleSizeStatusFor, shrinkSuccessRate } from "@/server/intelligence/decision-intelligence/sample-safety";
import {
  CANDIDATE_RELATED_ENTITY_TYPES,
  type CandidateTypePerformance,
  type RulePerformanceEntry,
  type ShrunkPerformance,
} from "@/server/intelligence/decision-intelligence/types";

/**
 * The 3 evaluation rules Sprint 11 actually shipped, named via their own
 * exported constants (never re-typed as string literals here) so this list
 * can never silently drift from the real rule modules. Discovered by
 * inspection, not assumed -- see the Sprint 12 audit report.
 */
const KNOWN_EVALUATION_RULES: { ruleName: string; ruleVersion: string }[] = [
  { ruleName: STALE_ADVISORY_RULE_NAME, ruleVersion: STALE_ADVISORY_RULE_VERSION },
  { ruleName: RISK_RESOLUTION_RULE_NAME, ruleVersion: RISK_RESOLUTION_RULE_VERSION },
  { ruleName: OPPORTUNITY_PROGRESSION_RULE_NAME, ruleVersion: OPPORTUNITY_PROGRESSION_RULE_VERSION },
];

/**
 * Historical performance keyed by `Outcome.relatedEntityType` ("Opportunity"
 * / "Risk") -- the real, non-fabricated stand-in for "decision candidate
 * type" this codebase actually has, since `Decision` itself carries no
 * `type`/`category` field and is a fully-recomputed, non-historical
 * singleton (see the Sprint 12 audit report). This is deliberately a
 * DIFFERENT dimension from `getRulePerformance` below: today there happens
 * to be exactly one generation rule per entity type
 * (`high_value_stalled_lead` for Opportunity, `at_risk_subscription` for
 * Risk), but `relatedEntityType` and the evaluation rule that judged it are
 * conceptually distinct and kept as two separate functions rather than
 * silently coupled.
 */
export async function getCandidateTypePerformance(organizationId: string): Promise<CandidateTypePerformance[]> {
  return Promise.all(
    CANDIDATE_RELATED_ENTITY_TYPES.map(async (relatedEntityType) => {
      const performance = await getOutcomePerformance({ organizationId, relatedEntityType });
      const shrunk: ShrunkPerformance = {
        ...performance,
        shrunkSuccessRate: shrinkSuccessRate(performance.successCount, performance.totalEvaluated),
        sampleSizeStatus: sampleSizeStatusFor(performance.totalEvaluated),
      };
      return { relatedEntityType, performance: shrunk };
    }),
  );
}

/**
 * Historical performance per Sprint 11 evaluation rule -- "which evaluation
 * rule is more reliable?" (Sprint 12 spec section 13). `ruleVersion` is
 * preserved as its own dimension (not collapsed into `ruleName`) so a
 * future `v2` of any of these rules gets its own independent track record
 * rather than being blended with `v1`'s history.
 */
export async function getRulePerformance(organizationId: string): Promise<RulePerformanceEntry[]> {
  return Promise.all(
    KNOWN_EVALUATION_RULES.map(async ({ ruleName, ruleVersion }) => {
      const performance = await getOutcomePerformance({ organizationId, ruleName, ruleVersion });
      return { ruleName, ruleVersion, performance };
    }),
  );
}
