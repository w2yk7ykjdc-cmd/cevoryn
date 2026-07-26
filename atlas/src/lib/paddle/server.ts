import "server-only";

import type { BillingPlan } from "@/features/billing/config/plans";

export class PaddleConfigurationError extends Error {}

export function getPaddleApiBase(): string {
  return process.env.PADDLE_ENV === "sandbox"
    ? "https://sandbox-api.paddle.com"
    : "https://api.paddle.com";
}

export function getPaddlePriceId(plan: BillingPlan): string {
  const key = `PADDLE_PRICE_${plan}` as const;
  const value = process.env[key]?.trim();
  if (!value) throw new PaddleConfigurationError(`${key} is not configured.`);
  return value;
}

export function getBillingPlanFromPaddlePriceId(priceId: string): BillingPlan | null {
  const pairs: Array<[BillingPlan, string | undefined]> = [
    ["STARTER", process.env.PADDLE_PRICE_STARTER],
    ["PROFESSIONAL", process.env.PADDLE_PRICE_PROFESSIONAL],
    ["BUSINESS", process.env.PADDLE_PRICE_BUSINESS],
  ];
  return pairs.find(([, configured]) => configured === priceId)?.[0] ?? null;
}

export async function paddleApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const apiKey = process.env.PADDLE_API_KEY?.trim();
  if (!apiKey) throw new PaddleConfigurationError("PADDLE_API_KEY is not configured.");

  const response = await fetch(`${getPaddleApiBase()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => null)) as T | { error?: { detail?: string } } | null;
  if (!response.ok) {
    const detail = payload && "error" in payload ? payload.error?.detail : undefined;
    throw new Error(detail ?? `Paddle API request failed with ${response.status}.`);
  }
  return payload as T;
}
