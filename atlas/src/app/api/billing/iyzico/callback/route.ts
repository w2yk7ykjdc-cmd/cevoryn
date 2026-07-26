import { NextResponse } from "next/server";

import type { SubscriptionStatus } from "@/features/billing/types";
import { getAppUrl } from "@/lib/app-url";
import { getBillingPlanFromIyzicoReferenceCode } from "@/lib/iyzico/config";
import {
  retrieveIyzicoSubscription,
  type IyzicoSubscriptionState,
} from "@/lib/iyzico/subscription";
import { syncIyzicoSubscription } from "@/server/services/iyzico-billing.service";

export const runtime = "nodejs";

function mapStatus(status: IyzicoSubscriptionState): SubscriptionStatus {
  switch (status) {
    case "ACTIVE":
    case "UPGRADED":
      return "ACTIVE";
    case "UNPAID":
      return "UNPAID";
    case "CANCELED":
    case "EXPIRED":
      return "CANCELED";
    case "PENDING":
    default:
      return "INCOMPLETE";
  }
}

function toDate(value?: number): Date | null {
  return value ? new Date(value) : null;
}

async function readToken(request: Request): Promise<string | null> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
    return typeof body?.token === "string" ? body.token : null;
  }

  const form = await request.formData().catch(() => null);
  const token = form?.get("token");
  return typeof token === "string" ? token : null;
}

export async function POST(request: Request): Promise<NextResponse> {
  const billingUrl = new URL("/settings/billing", getAppUrl());
  const token = await readToken(request);
  if (!token) {
    billingUrl.searchParams.set("checkout", "invalid-callback");
    return NextResponse.redirect(billingUrl, 303);
  }

  try {
    const result = await retrieveIyzicoSubscription(token);
    const conversationId = result.conversationId;
    const organizationId = conversationId?.split(":", 1)[0];
    if (!organizationId) throw new Error("iyzico callback is missing organization correlation.");

    await syncIyzicoSubscription({
      organizationId,
      plan: getBillingPlanFromIyzicoReferenceCode(
        result.data.pricingPlanReferenceCode
      ),
      customerReferenceCode: result.data.customerReferenceCode,
      subscriptionReferenceCode: result.data.referenceCode,
      pricingPlanReferenceCode: result.data.pricingPlanReferenceCode,
      subscriptionStatus: mapStatus(result.data.subscriptionStatus),
      currentPeriodStart: toDate(result.data.startDate),
      currentPeriodEnd: toDate(result.data.endDate),
      trialEnd: toDate(result.data.trialEndDate),
    });

    billingUrl.searchParams.set(
      "checkout",
      result.data.subscriptionStatus === "ACTIVE" ? "success" : "pending"
    );
    return NextResponse.redirect(billingUrl, 303);
  } catch (error) {
    console.error("[cevoryn:iyzico] Callback processing failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    billingUrl.searchParams.set("checkout", "failed");
    return NextResponse.redirect(billingUrl, 303);
  }
}
