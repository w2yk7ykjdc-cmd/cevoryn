import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { getMembership, getUser } from "@/lib/auth";
import { paddleApi, PaddleConfigurationError } from "@/lib/paddle/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

function canManageBilling(role: string): boolean {
  return role === "OWNER" || role === "ADMIN";
}

type PaddleSubscriptionRow = {
  paddle_customer_id: string | null;
  paddle_subscription_id: string | null;
};

type PortalResponse = {
  data: {
    urls: { general: { overview: string } };
  };
};

export async function POST(): Promise<NextResponse> {
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

  try {
    const rows = await prisma.$queryRaw<PaddleSubscriptionRow[]>(Prisma.sql`
      SELECT "paddle_customer_id", "paddle_subscription_id"
      FROM "subscriptions"
      WHERE "organization_id" = ${membership.organizationId}
      LIMIT 1
    `);
    const subscription = rows[0];
    if (!subscription?.paddle_customer_id) {
      return NextResponse.json(
        { error: "No Paddle billing account exists for this organization." },
        { status: 404 }
      );
    }

    const payload = await paddleApi<PortalResponse>(
      `/customers/${subscription.paddle_customer_id}/portal-sessions`,
      {
        method: "POST",
        body: JSON.stringify(
          subscription.paddle_subscription_id
            ? { subscription_ids: [subscription.paddle_subscription_id] }
            : {}
        ),
      }
    );

    return NextResponse.json({ url: payload.data.urls.general.overview });
  } catch (error) {
    console.error("[cevoryn:paddle] Portal creation failed", {
      organizationId: membership.organizationId,
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json(
      {
        error:
          error instanceof PaddleConfigurationError
            ? error.message
            : "Unable to open billing management.",
      },
      { status: 500 }
    );
  }
}
