import { getDecisionCandidatesForOrganization, getDecisionForOrganization } from "@/server/intelligence/decision/service";
import { getConfidenceCalibration } from "@/server/intelligence/learning/service";
import type { ConfidenceBucket } from "@/server/intelligence/learning/types";
import { getCandidateTypePerformance, getRulePerformance } from "@/server/intelligence/decision-intelligence/performance";
import { rankDecisionCandidates } from "@/server/intelligence/decision-intelligence/ranking";
import type {
  CandidateRelatedEntityType,
  CandidateTypePerformance,
  RankedDecisionCandidate,
  RulePerformanceEntry,
  ShrunkPerformance,
} from "@/server/intelligence/decision-intelligence/types";

export type DecisionIntelligenceSnapshot = {
  currentDecision: Awaited<ReturnType<typeof getDecisionForOrganization>>;
  rankedCandidates: RankedDecisionCandidate[];
  candidateTypePerformance: CandidateTypePerformance[];
  rulePerformance: RulePerformanceEntry[];
  confidenceCalibration: ConfidenceBucket[];
};

/**
 * The single read-only entry point Sprint 12's AI tools and UI page both
 * call. Purely advisory: reads Sprint 8's current `Decision` singleton and
 * its live candidate set, reads Sprint 11's outcome/learning data, and
 * deterministically ranks -- writes nothing, calls no LLM, and can never
 * itself change which `Decision` row Sprint 8's own engine has recorded.
 */
export async function getDecisionIntelligenceSnapshot(organizationId: string): Promise<DecisionIntelligenceSnapshot> {
  const [currentDecision, candidates, candidateTypePerformance, rulePerformance, confidenceCalibration] = await Promise.all([
    getDecisionForOrganization(organizationId),
    getDecisionCandidatesForOrganization(organizationId),
    getCandidateTypePerformance(organizationId),
    getRulePerformance(organizationId),
    getConfidenceCalibration(organizationId),
  ]);

  const performanceByType = new Map<CandidateRelatedEntityType, ShrunkPerformance>(
    candidateTypePerformance.map((entry) => [entry.relatedEntityType, entry.performance]),
  );

  return {
    currentDecision,
    rankedCandidates: rankDecisionCandidates(candidates, performanceByType),
    candidateTypePerformance,
    rulePerformance,
    confidenceCalibration,
  };
}
