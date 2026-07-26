import { NextResponse } from "next/server";

import {
  getPaddleApiBaseUrl,
  getPaddleApiKey,
  getPaddleEnvironment,
  getPaddlePriceId,
} from "@/lib/paddle/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PaddlePriceResponse = {
  data?: {
    id?: string;
    status?: string;
    product_id?: string;
    billing_cycle?: { interval?: string; frequency?: number } | null;
    unit_price?: { amount?: string; currency_code?: string };
  };
  error?: {
    code?: string;
    detail?: string;
  };
};

function suffix(value: string | undefined): string | undefined {
  return value ? value.slice(-6) : undefined;
}

async function inspectPrice(plan: "STARTER" | "PROFESSIONAL" | "BUSINESS") {
  const priceId = getPaddlePriceId(plan);
  const response = await fetch(`${getPaddleApiBaseUrl()}/prices/${priceId}`, {
    headers: {
      Authorization: `Bearer ${getPaddleApiKey()}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const payload = (await response.json()) as PaddlePriceResponse;

  if (!response.ok || !payload.data) {
    return {
      configuredPriceSuffix: suffix(priceId),
      found: false,
      httpStatus: response.status,
      errorCode: payload.error?.code ?? "unknown",
      errorDetail: payload.error?.detail ?? "Paddle did not return price data.",
    };
  }

  return {
    configuredPriceSuffix: suffix(priceId),
    found: true,
    returnedPriceSuffix: suffix(payload.data.id),
    status: payload.data.status ?? "unknown",
    productSuffix: suffix(payload.data.product_id),
    billingCycle: payload.data.billing_cycle ?? null,
    currency: payload.data.unit_price?.currency_code ?? null,
    amount: payload.data.unit_price?.amount ?? null,
  };
}

export async function GET(): Promise<NextResponse> {
  try {
    const [starter, professional, business] = await Promise.all([
      inspectPrice("STARTER"),
      inspectPrice("PROFESSIONAL"),
      inspectPrice("BUSINESS"),
    ]);

    return NextResponse.json(
      {
        environment: getPaddleEnvironment(),
        apiBaseUrl: getPaddleApiBaseUrl(),
        prices: { starter, professional, business },
        note: "Temporary public diagnostic. No API keys or complete price/product IDs are returned.",
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (error) {
    return NextResponse.json(
      {
        environment: getPaddleEnvironment(),
        error: error instanceof Error ? error.message : "Unknown diagnostics error.",
      },
      {
        status: 500,
        headers: { "Cache-Control": "no-store, max-age=0" },
      }
    );
  }
}
