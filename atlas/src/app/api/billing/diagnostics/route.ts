import { NextResponse } from "next/server";

import { getUser } from "@/lib/auth";
import { getPaddleEnvironment } from "@/lib/paddle/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function GET(): Promise<NextResponse> {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const environment = getPaddleEnvironment();
  const clientTokenEnvironment = classifyClientToken(
    process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN
  );

  return NextResponse.json(
    {
      environment,
      clientTokenEnvironment,
      environmentMatchesClientToken:
        clientTokenEnvironment === environment,
      apiKeyConfigured: Boolean(process.env.PADDLE_API_KEY?.trim()),
      webhookSecretConfigured: Boolean(
        process.env.PADDLE_WEBHOOK_SECRET?.trim()
      ),
      prices: {
        starter: inspectPrice(process.env.PADDLE_PRICE_STARTER),
        professional: inspectPrice(process.env.PADDLE_PRICE_PROFESSIONAL),
        business: inspectPrice(process.env.PADDLE_PRICE_BUSINESS),
      },
      note: "No secret values are returned. Price suffixes are included only to compare environments/accounts.",
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}
