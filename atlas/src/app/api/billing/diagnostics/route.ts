import { NextResponse } from "next/server";

import { getUser } from "@/lib/auth";
import {
  getPaddleApiBaseUrl,
  getPaddleApiKey,
  getPaddleEnvironment,
} from "@/lib/paddle/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CatalogCheck = {
  reachable: boolean;
  httpStatus: number;
  exists: boolean;
  active: boolean | null;
  recurring: boolean | null;
  billingInterval: string | null;
  currencyCode: string | null;
  productStatus: string | null;
  errorCode?: string;
  errorDetail?: string;
  requestId?: string;
};

type PaddlePriceResponse = {
  data?: {
    status?: string;
    billing_cycle?: { interval?: string } | null;
    unit_price?: { currency_code?: string } | null;
    product?: { status?: string } | null;
  };
  error?: { code?: string; detail?: string };
  meta?: { request_id?: string };
};

function classifyClientToken(value: string | undefined): "missing" | "sandbox" | "production" | "unknown" {
  const token = value?.trim();
  if (!token) return "missing";
  if (token.startsWith("test_")) return "sandbox";
  if (token.startsWith("live_")) return "production";
  return "unknown";
}

function inspectPrice(value: string | undefined): { configured: boolean; format: "pri" | "unknown" | "missing"; suffix?: string } {
  const price = value?.trim();
  if (!price) return { configured: false, format: "missing" };

  return {
    configured: true,
    format: price.startsWith("pri_") ? "pri" : "unknown",
    suffix: price.slice(-6),
  };
}

async function checkCatalogPrice(priceId: string | undefined): Promise<CatalogCheck> {
  const id = priceId?.trim();
  if (!id) {
    return {
      reachable: false,
      httpStatus: 0,
      exists: false,
      active: null,
      recurring: null,
      billingInterval: null,
      currencyCode: null,
      productStatus: null,
      errorCode: "price_id_missing",
    };
  }

  try {
    const response = await fetch(
      `${getPaddleApiBaseUrl()}/prices/${encodeURIComponent(id)}?include=product`,
      {
        headers: {
          Authorization: `Bearer ${getPaddleApiKey()}`,
          Accept: "application/json",
        },
        cache: "no-store",
      }
    );
    const body = (await response.json()) as PaddlePriceResponse;
    const data = body.data;

    return {
      reachable: true,
      httpStatus: response.status,
      exists: response.ok && Boolean(data),
      active: data?.status ? data.status === "active" : null,
      recurring: data?.billing_cycle !== undefined ? data.billing_cycle !== null : null,
      billingInterval: data?.billing_cycle?.interval ?? null,
      currencyCode: data?.unit_price?.currency_code ?? null,
      productStatus: data?.product?.status ?? null,
      errorCode: body.error?.code,
      errorDetail: body.error?.detail,
      requestId: body.meta?.request_id,
    };
  } catch (error) {
    return {
      reachable: false,
      httpStatus: 0,
      exists: false,
      active: null,
      recurring: null,
      billingInterval: null,
      currencyCode: null,
      productStatus: null,
      errorCode: "network_or_configuration_error",
      errorDetail: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function GET(): Promise<NextResponse> {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const environment = getPaddleEnvironment();
  const clientTokenEnvironment = classifyClientToken(
    process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN
  );

  const [starterCatalog, professionalCatalog, businessCatalog] = await Promise.all([
    checkCatalogPrice(process.env.PADDLE_PRICE_STARTER),
    checkCatalogPrice(process.env.PADDLE_PRICE_PROFESSIONAL),
    checkCatalogPrice(process.env.PADDLE_PRICE_BUSINESS),
  ]);

  return NextResponse.json(
    {
      environment,
      clientTokenEnvironment,
      environmentMatchesClientToken: clientTokenEnvironment === environment,
      apiKeyConfigured: Boolean(process.env.PADDLE_API_KEY?.trim()),
      webhookSecretConfigured: Boolean(process.env.PADDLE_WEBHOOK_SECRET?.trim()),
      prices: {
        starter: {
          ...inspectPrice(process.env.PADDLE_PRICE_STARTER),
          catalog: starterCatalog,
        },
        professional: {
          ...inspectPrice(process.env.PADDLE_PRICE_PROFESSIONAL),
          catalog: professionalCatalog,
        },
        business: {
          ...inspectPrice(process.env.PADDLE_PRICE_BUSINESS),
          catalog: businessCatalog,
        },
      },
      note: "No secret values or complete price IDs are returned. Catalog checks are performed against the effective Paddle environment using the configured API key.",
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}
