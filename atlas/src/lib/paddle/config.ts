import "server-only";

import type { BillingPlan } from "@/features/billing/config/plans";

export class PaddleConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaddleConfigurationError";
  }
}

export function getPaddleEnvironment(): "sandbox" | "production" {
  return process.env.PADDLE_ENV === "sandbox" ? "sandbox" : "production";
}

export function getPaddleApiBaseUrl(): string {
  return getPaddleEnvironment() === "sandbox"
    ? "https://sandbox-api.paddle.com"
    : "https://api.paddle.com";
}

export function getPaddleApiKey(): string {
  const value = process.env.PADDLE_API_KEY?.trim();
  if (!value) throw new PaddleConfigurationError("PADDLE_API_KEY is not configured.");
  return value;
}

export function getPaddleWebhookSecret(): string {
  const value = process.env.PADDLE_WEBHOOK_SECRET?.trim();
  if (!value) {
    throw new PaddleConfigurationError("PADDLE_WEBHOOK_SECRET is not configured.");
  }
  return value;
}

export function getPaddlePriceId(plan: BillingPlan): string {
  const variableName = `PADDLE_PRICE_${plan}` as const;
  const value = process.env[variableName]?.trim();
  if (!value) {
    throw new PaddleConfigurationError(`${variableName} is not configured.`);
  }
  return value;
}
