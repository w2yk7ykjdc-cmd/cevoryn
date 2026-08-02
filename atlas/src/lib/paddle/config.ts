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
  if (!value)
    throw new PaddleConfigurationError("PADDLE_API_KEY is not configured.");
  return value;
}

export function getPaddleWebhookSecret(): string {
  const value = process.env.PADDLE_WEBHOOK_SECRET?.trim();
  if (!value) {
    throw new PaddleConfigurationError(
      "PADDLE_WEBHOOK_SECRET is not configured."
    );
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

export function getBillingPlanFromPaddlePriceId(
  priceId: string
): BillingPlan | null {
  const pairs: Array<[BillingPlan, string | undefined]> = [
    ["STARTER", process.env.PADDLE_PRICE_STARTER],
    ["PROFESSIONAL", process.env.PADDLE_PRICE_PROFESSIONAL],
    ["BUSINESS", process.env.PADDLE_PRICE_BUSINESS],
  ];
  return pairs.find(([, configured]) => configured === priceId)?.[0] ?? null;
}

type PaddleErrorPayload = {
  error?: {
    detail?: string;
  };
};

function getPaddleErrorDetail(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || !("error" in payload)) {
    return undefined;
  }

  const error = (payload as PaddleErrorPayload).error;
  return error?.detail;
}

export async function paddleApi<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const apiKey = getPaddleApiKey();

  const response = await fetch(`${getPaddleApiBaseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      getPaddleErrorDetail(payload) ??
        `Paddle API request failed with ${response.status}.`
    );
  }

  return payload as T;
}
