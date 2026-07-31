export const BILLING_PLANS = ["STARTER", "PROFESSIONAL", "BUSINESS"] as const;

export type BillingPlan = (typeof BILLING_PLANS)[number];

export const BILLING_FEATURES = [
  "CHAT",
  "DASHBOARD",
  "DECISION_SUPPORT",
  "BRAIN",
  "ADVANCED_REPORTS",
  "TEAM",
  "ADVANCED_RBAC",
  "PRIORITY_SUPPORT",
] as const;

export type BillingFeature = (typeof BILLING_FEATURES)[number];

export interface PlanLimits {
  maxOrganizations: number;
  maxMembers: number;
  monthlyAiTokens: number;
}

export interface PlanDefinition {
  name: string;
  description: string;
  recommended: boolean;
  limits: PlanLimits;
  features: ReadonlySet<BillingFeature>;
}

const sharedFeatures = new Set<BillingFeature>([
  "CHAT",
  "DASHBOARD",
  "DECISION_SUPPORT",
]);

export const PLAN_CONFIG: Record<BillingPlan, PlanDefinition> = {
  STARTER: {
    name: "Starter",
    description: "CEVORYN's core AI and decision support features.",
    recommended: false,
    limits: {
      maxOrganizations: 1,
      maxMembers: 3,
      monthlyAiTokens: 250_000,
    },
    features: new Set<BillingFeature>([...sharedFeatures, "TEAM"]),
  },
  PROFESSIONAL: {
    name: "Professional",
    description: "Brain, reports, and advanced decision support for growing teams.",
    recommended: true,
    limits: {
      maxOrganizations: 1,
      maxMembers: 5,
      monthlyAiTokens: 1_500_000,
    },
    features: new Set<BillingFeature>([
      ...sharedFeatures,
      "BRAIN",
      "ADVANCED_REPORTS",
      "TEAM",
    ]),
  },
  BUSINESS: {
    name: "Business",
    description: "Higher limits and advanced administration for larger teams.",
    recommended: false,
    limits: {
      maxOrganizations: 1,
      maxMembers: 20,
      monthlyAiTokens: 5_000_000,
    },
    features: new Set<BillingFeature>([
      ...sharedFeatures,
      "BRAIN",
      "ADVANCED_REPORTS",
      "TEAM",
      "ADVANCED_RBAC",
      "PRIORITY_SUPPORT",
    ]),
  },
};

export function isBillingPlan(value: string): value is BillingPlan {
  return BILLING_PLANS.includes(value as BillingPlan);
}

export function getPlanDefinition(plan: BillingPlan): PlanDefinition {
  return PLAN_CONFIG[plan];
}

export function getPlanLimits(plan: BillingPlan): PlanLimits {
  return PLAN_CONFIG[plan].limits;
}

export function hasFeature(plan: BillingPlan, feature: BillingFeature): boolean {
  return PLAN_CONFIG[plan].features.has(feature);
}

export class FeatureAccessError extends Error {
  readonly code = "FEATURE_NOT_AVAILABLE";

  constructor(
    readonly plan: BillingPlan,
    readonly feature: BillingFeature
  ) {
    super(`${feature} is not available on the ${plan} plan.`);
    this.name = "FeatureAccessError";
  }
}

export function assertFeatureAccess(
  plan: BillingPlan,
  feature: BillingFeature
): void {
  if (!hasFeature(plan, feature)) {
    throw new FeatureAccessError(plan, feature);
  }
}

export function canInviteMember(
  plan: BillingPlan,
  currentMemberCount: number
): boolean {
  return currentMemberCount < getPlanLimits(plan).maxMembers;
}

export function canUseBrain(plan: BillingPlan): boolean {
  return hasFeature(plan, "BRAIN");
}

export function canGenerateReport(plan: BillingPlan): boolean {
  return hasFeature(plan, "ADVANCED_REPORTS");
}
