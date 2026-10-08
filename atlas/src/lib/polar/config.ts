import "server-only";

import type { BillingPlan } from "@/features/billing/config/plans";

export class PolarConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolarConfigurationError";
  }
}

/**
 * Thrown only for a real error response FROM Polar's API (declined card,
 * invalid product, etc.) - its message is authored by Polar/us to be safe
 * to relay to the org admin who triggered the request. Deliberately a
 * distinct class from a plain Error so callers can tell "safe to show the
 * user" apart from an unexpected internal exception (Prisma error, bug,
 * network failure) whose raw message must never reach the client.
 */
export class PolarApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolarApiError";
  }
}

export function getPolarEnvironment(): "sandbox" | "production" {
  return process.env.POLAR_ENV === "sandbox" ? "sandbox" : "production";
}

export function getPolarApiBaseUrl(): string {
  return getPolarEnvironment() === "sandbox"
    ? "https://sandbox-api.polar.sh"
    : "https://api.polar.sh";
}

export function getPolarAccessToken(): string {
  const value = process.env.POLAR_ACCESS_TOKEN?.trim();
  if (!value) {
    throw new PolarConfigurationError("POLAR_ACCESS_TOKEN is not configured.");
  }
  return value;
}

export function getPolarWebhookSecret(): string {
  const value = process.env.POLAR_WEBHOOK_SECRET?.trim();
  if (!value) {
    throw new PolarConfigurationError(
      "POLAR_WEBHOOK_SECRET is not configured."
    );
  }
  return value;
}

export function getPolarProductId(plan: BillingPlan): string {
  const variableName = `POLAR_PRODUCT_${plan}` as const;
  const value = process.env[variableName]?.trim();
  if (!value) {
    throw new PolarConfigurationError(`${variableName} is not configured.`);
  }
  return value;
}

/** The single Romance product (PREMIUM) - a distinct Polar product from any B2B plan's, per ADR-0001. */
export function getRomancePremiumPolarProductId(): string {
  const value = process.env.POLAR_PRODUCT_ROMANCE_PREMIUM?.trim();
  if (!value) {
    throw new PolarConfigurationError(
      "POLAR_PRODUCT_ROMANCE_PREMIUM is not configured."
    );
  }
  return value;
}

type PolarErrorPayload = {
  error?: string;
  detail?: string | Array<{ msg?: string }>;
};

function getPolarErrorDetail(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;

  const { detail, error } = payload as PolarErrorPayload;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => item.msg)
      .filter((msg): msg is string => Boolean(msg));
    if (messages.length > 0) return messages.join("; ");
  }
  return error;
}

export async function polarApi<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const accessToken = getPolarAccessToken();

  const response = await fetch(`${getPolarApiBaseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new PolarApiError(
      getPolarErrorDetail(payload) ??
        `Polar API request failed with ${response.status}.`
    );
  }

  return payload as T;
}
