import type { SignalSeverity } from "@prisma/client";

export const RULE_NAME = "at_risk_subscription";
export const RULE_VERSION = "v1";

export type AtRiskSubscriptionInput = {
  subscriptionId: string;
  status: string;
  monthlyPriceCents: number;
  signalSeverity: SignalSeverity;
  signalConfidence: number;
  signalId: string;
};

export type GeneratedRisk = {
  type: string;
  title: string;
  description: string;
  severity: SignalSeverity;
  confidence: number;
  potentialLoss: number;
  evidence: Record<string, unknown>;
  explanation: string;
  relatedEntityType: string;
  relatedEntityId: string;
  sourceSignalId: string;
  ruleName: string;
  ruleVersion: string;
};

/**
 * Converts an unhealthy `billing.subscription_updated` CompanySignal into a
 * Risk — V1's only rule. Deliberately does not re-derive "unhealthy" from
 * Stripe status codes a second time; that classification already exists
 * (`UNHEALTHY_SUBSCRIPTION_STATUSES` in
 * `src/server/jobs/processors/record-company-signal.ts`), so this rule
 * trusts the signal's own `severity` instead of re-implementing the same
 * status-to-severity mapping.
 *
 * `potentialLoss` is the plan's real `monthlyPriceCents` (via the
 * organization's own `Subscription.plan`), not an invented or LLM-guessed
 * figure — the same "code-computed, or not computed at all" discipline
 * used elsewhere in this codebase's economic-value work.
 */
export function generateAtRiskSubscriptionRisk(input: AtRiskSubscriptionInput): GeneratedRisk {
  const monthlyPrice = input.monthlyPriceCents / 100;

  return {
    type: RULE_NAME,
    title: `Subscription at risk: ${input.status}`,
    description: `This organization's paid subscription is "${input.status}", putting recurring revenue at risk.`,
    severity: input.signalSeverity,
    confidence: input.signalConfidence,
    potentialLoss: monthlyPrice,
    evidence: {
      subscriptionStatus: input.status,
      monthlyPriceCents: input.monthlyPriceCents,
    },
    explanation:
      `The subscription is currently "${input.status}". If not resolved, the organization risks losing access ` +
      `and the $${monthlyPrice.toLocaleString()}/month in recurring revenue it represents.`,
    relatedEntityType: "Subscription",
    relatedEntityId: input.subscriptionId,
    sourceSignalId: input.signalId,
    ruleName: RULE_NAME,
    ruleVersion: RULE_VERSION,
  };
}
