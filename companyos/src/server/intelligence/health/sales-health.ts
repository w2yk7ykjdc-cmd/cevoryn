import { getTenantScopedClient } from "@/server/db/tenant";
import { analyzeLead } from "@/server/leads/analysis";

export const SALES_HEALTH_RULE_VERSION = "v1";

export type SalesHealthEvidence = {
  totalOpenLeads: number;
  highRiskLeadCount: number;
  mediumRiskLeadCount: number;
  lowRiskLeadCount: number;
  overdueTaskCount: number;
  averageDaysSinceLastActivity: number;
};

/**
 * Deterministic, rule-based org-level score — no LLM call, fully
 * unit-testable. Starts at 100 and subtracts a weighted penalty for the
 * share of open leads that `analyzeLead()` classifies as "high" or "medium"
 * risk: high-risk leads (stale or carrying an overdue task) cost more per
 * lead than medium-risk ones (aging but not yet stale). An organization
 * with no open leads has nothing at risk, so it scores a clean 100 rather
 * than an undefined or arbitrary value.
 */
export function computeSalesHealthScore(evidence: SalesHealthEvidence): number {
  if (evidence.totalOpenLeads === 0) return 100;

  const highRiskRatio = evidence.highRiskLeadCount / evidence.totalOpenLeads;
  const mediumRiskRatio = evidence.mediumRiskLeadCount / evidence.totalOpenLeads;

  const raw = 100 - highRiskRatio * 70 - mediumRiskRatio * 30;
  return Math.round(Math.min(100, Math.max(0, raw)));
}

/**
 * Gathers the evidence `computeSalesHealthScore` needs by running the same,
 * already-established `analyzeLead()` (`src/server/leads/analysis.ts`) over
 * every open lead in the organization — the identical deterministic
 * per-lead risk classification the lead detail page's AI analysis already
 * uses, aggregated here into an org-level view instead of computing a new,
 * parallel notion of "risk."
 */
export async function computeSalesHealthEvidence(organizationId: string): Promise<SalesHealthEvidence> {
  const scoped = getTenantScopedClient(organizationId);

  const openLeads = await scoped.lead.findMany({
    where: { deletedAt: null, stage: { isWon: false, isLost: false } },
    select: {
      title: true,
      value: true,
      probability: true,
      createdAt: true,
      stage: { select: { name: true, isWon: true, isLost: true } },
      activities: { select: { createdAt: true } },
      tasks: { select: { status: true, dueDate: true } },
    },
  });

  let highRiskLeadCount = 0;
  let mediumRiskLeadCount = 0;
  let lowRiskLeadCount = 0;
  let overdueTaskCount = 0;
  let totalDaysSinceLastActivity = 0;

  for (const lead of openLeads) {
    const analysis = analyzeLead({ ...lead, value: Number(lead.value) });

    if (analysis.riskLevel === "high") highRiskLeadCount += 1;
    else if (analysis.riskLevel === "medium") mediumRiskLeadCount += 1;
    else lowRiskLeadCount += 1;

    overdueTaskCount += analysis.overdueTaskCount;
    totalDaysSinceLastActivity += analysis.daysSinceLastActivity;
  }

  const totalOpenLeads = openLeads.length;
  const averageDaysSinceLastActivity = totalOpenLeads === 0 ? 0 : Math.round(totalDaysSinceLastActivity / totalOpenLeads);

  return {
    totalOpenLeads,
    highRiskLeadCount,
    mediumRiskLeadCount,
    lowRiskLeadCount,
    overdueTaskCount,
    averageDaysSinceLastActivity,
  };
}
