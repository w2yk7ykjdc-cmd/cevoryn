import { RULE_NAME, RULE_VERSION } from "@/server/intelligence/signals/rules/high-value-stalled-lead";

export type StalledLeadOpportunityInput = {
  leadId: string;
  leadTitle: string;
  leadValue: number;
  orgMedianOpenValue: number;
  daysSinceLastActivity: number;
  hasActivityHistory: boolean;
  signalSeverity: "medium" | "high";
  signalConfidence: number;
  signalId: string;
};

export type GeneratedOpportunity = {
  type: string;
  title: string;
  description: string;
  score: number;
  confidence: number;
  potentialImpact: number;
  effort: "low" | "medium" | "high";
  urgency: "low" | "medium" | "high" | "critical";
  risk: "low" | "medium" | "high" | "critical";
  evidence: Record<string, unknown>;
  explanation: string;
  relatedEntityType: string;
  relatedEntityId: string;
  sourceSignalId: string;
  ruleName: string;
  ruleVersion: string;
};

/**
 * Converts an active `high_value_stalled_lead` CompanySignal into an
 * actionable Opportunity — this is the V1 Opportunity Engine's only rule.
 * It deliberately does NOT re-derive staleness/value detection from scratch;
 * that already happened once, deterministically, in
 * `src/server/intelligence/signals/rules/high-value-stalled-lead.ts` (via
 * the scanner). Recomputing it here would risk the two diverging over time
 * for no benefit — the signal ledger is the single source of truth for
 * "is this stalled," and this rule only decides "is this worth surfacing as
 * an opportunity, and how should it be explained." Reuses that rule's exact
 * `RULE_NAME`/`RULE_VERSION` so the Opportunity stays traceable to the
 * signal that produced it.
 *
 * `effort` is always "low": the recommended action is a single re-engagement
 * touch (a call or email), not a multi-step campaign. `urgency` and `risk`
 * both mirror the signal's own severity — the urgency of acting and the risk
 * of not acting are the same thing for a single stalling deal, so a second,
 * independently-computed risk score would just add noise without changing
 * any observable behavior.
 */
export function generateHighValueStalledLeadOpportunity(input: StalledLeadOpportunityInput): GeneratedOpportunity {
  const score = Math.round(input.signalConfidence * (input.signalSeverity === "high" ? 1 : 0.75));

  return {
    type: RULE_NAME,
    title: `Re-engage stalled high-value lead: "${input.leadTitle}"`,
    description: `This lead is valued above the organization's median open deal and has had no recorded activity in ${input.daysSinceLastActivity} day(s).`,
    score,
    confidence: input.signalConfidence,
    potentialImpact: input.leadValue,
    effort: "low",
    urgency: input.signalSeverity,
    risk: input.signalSeverity,
    evidence: {
      leadValue: input.leadValue,
      orgMedianOpenValue: input.orgMedianOpenValue,
      daysSinceLastActivity: input.daysSinceLastActivity,
      hasActivityHistory: input.hasActivityHistory,
    },
    explanation:
      `"${input.leadTitle}" is a $${input.leadValue.toLocaleString()} deal, above this organization's median ` +
      `open deal size ($${input.orgMedianOpenValue.toLocaleString()}), with no recorded activity in ` +
      `${input.daysSinceLastActivity} day(s). Re-engaging now protects a high-value deal at risk of going cold.`,
    relatedEntityType: "Lead",
    relatedEntityId: input.leadId,
    sourceSignalId: input.signalId,
    ruleName: RULE_NAME,
    ruleVersion: RULE_VERSION,
  };
}
