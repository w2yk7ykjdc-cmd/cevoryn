import "server-only";

import type { BillingPlan } from "@/features/billing/config/plans";

export class IyzicoConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IyzicoConfigurationError";
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new IyzicoConfigurationError(`${name} is not configured.`);
  }
  return value;
}

export function getIyzicoConfig() {
  return {
    apiKey: requireEnv("IYZICO_API_KEY"),
    secretKey: requireEnv("IYZICO_SECRET_KEY"),
    baseUrl: (process.env.IYZICO_BASE_URL?.trim() || "https://sandbox-api.iyzipay.com").replace(/\/$/, ""),
  };
}

export function getIyzicoPricingPlanReferenceCode(plan: BillingPlan): string {
  const envName: Record<BillingPlan, string> = {
    STARTER: "IYZICO_PLAN_STARTER",
    PROFESSIONAL: "IYZICO_PLAN_PROFESSIONAL",
    BUSINESS: "IYZICO_PLAN_BUSINESS",
  };

  return requireEnv(envName[plan]);
}
