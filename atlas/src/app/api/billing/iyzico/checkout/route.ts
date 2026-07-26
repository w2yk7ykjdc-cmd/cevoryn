import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { iyzicoCheckoutRequestSchema } from "@/features/billing/schemas/iyzico-checkout";
import { isSubscriptionActive } from "@/features/billing/types";
import { getAppUrl } from "@/lib/app-url";
import { getMembership, getUser } from "@/lib/auth";
import { IyzicoApiError } from "@/lib/iyzico/client";
import {
  getIyzicoPricingPlanReferenceCode,
  IyzicoConfigurationError,
} from "@/lib/iyzico/config";
import { initializeIyzicoSubscription } from "@/lib/iyzico/subscription";
import { getOrganizationSubscription } from "@/server/services/billing.service";

export const runtime = "nodejs";

function canManageBilling(role: string): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export async function POST(request: Request): Promise<NextResponse> {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const membership = await getMembership(user.id);
  if (!membership) {
    return NextResponse.json({ error: "Organization membership is required." }, { status: 403 });
  }

  if (!canManageBilling(membership.role)) {
    return NextResponse.json(
      { error: "Only organization owners and admins can manage billing." },
      { status: 403 }
    );
  }

  const parsed = iyzicoCheckoutRequestSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ödeme ve fatura bilgileri eksik veya geçersiz.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const subscription = await getOrganizationSubscription(membership.organizationId);
  if (subscription && isSubscriptionActive(subscription.subscriptionStatus)) {
    return NextResponse.json(
      { error: "Bu organizasyonun zaten aktif bir aboneliği var." },
      { status: 409 }
    );
  }

  try {
    const conversationId = `${membership.organizationId}:${parsed.data.plan}:${randomUUID()}`;
    const contactName = `${parsed.data.customer.name} ${parsed.data.customer.surname}`;
    const address = {
      ...parsed.data.customer.billingAddress,
      contactName,
    };

    const result = await initializeIyzicoSubscription({
      callbackUrl: `${getAppUrl()}/api/billing/iyzico/callback`,
      pricingPlanReferenceCode: getIyzicoPricingPlanReferenceCode(parsed.data.plan),
      conversationId,
      customer: {
        name: parsed.data.customer.name,
        surname: parsed.data.customer.surname,
        email: user.email ?? "",
        gsmNumber: parsed.data.customer.gsmNumber,
        identityNumber: parsed.data.customer.identityNumber,
        billingAddress: address,
        shippingAddress: address,
      },
    });

    return NextResponse.json({
      token: result.token,
      checkoutFormContent: result.checkoutFormContent,
      expiresIn: result.tokenExpireTime ?? 1800,
    });
  } catch (error) {
    console.error("[cevoryn:iyzico] Checkout initialization failed", {
      organizationId: membership.organizationId,
      message: error instanceof Error ? error.message : "Unknown error",
    });

    const message =
      error instanceof IyzicoConfigurationError || error instanceof IyzicoApiError
        ? error.message
        : "iyzico ödeme formu başlatılamadı.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
