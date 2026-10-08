import { NextResponse } from "next/server";

import { isRomancePremiumActive } from "@/features/romance/billing/entitlement-math";
import { getRomanceSubscription } from "@/features/romance/billing/romance-subscription.service";
import {
  getAdultRomancePlayerOrThrow,
  RomanceAgeNotVerifiedError,
  RomanceNotAuthenticatedError,
} from "@/features/romance/player/romance-player-guards";
import { tooManyRequestsResponse } from "@/lib/api-utils";
import { captureServerError } from "@/lib/error-reporting";
import {
  getRomancePremiumPolarProductId,
  polarApi,
  PolarApiError,
  PolarConfigurationError,
} from "@/lib/polar/config";
import { tryRecordAuthAttempt } from "@/server/services/auth-rate-limit.service";

export const runtime = "nodejs";

type PolarCheckoutResponse = {
  url: string;
};

/**
 * Romance's own checkout route - separate from /api/billing/polar/checkout
 * on purpose (ADR-0001). Gated by requireAdultRomancePlayer semantics
 * (18+ verified, since PREMIUM is a mature-content-adjacent product
 * surface), never by org membership/getMembership().
 * external_customer_id is prefixed ("romance:") so it can never collide
 * with a B2B organizationId in the same Polar account's customer
 * namespace.
 */
export async function POST(): Promise<NextResponse> {
  let player: { id: string };
  let userEmail: string | undefined;
  try {
    const result = await getAdultRomancePlayerOrThrow();
    player = result.player;
    userEmail = result.user.email ?? undefined;
  } catch (error) {
    if (error instanceof RomanceNotAuthenticatedError) {
      return NextResponse.json({ error: "Please sign in to continue." }, { status: 401 });
    }
    if (error instanceof RomanceAgeNotVerifiedError) {
      return NextResponse.json(
        { error: "18+ age verification is required." },
        { status: 403 }
      );
    }
    throw error;
  }

  if (!(await tryRecordAuthAttempt("romance_polar_checkout", player.id))) {
    return tooManyRequestsResponse("Too many checkout attempts. Please try again shortly.");
  }

  try {
    const existing = await getRomanceSubscription(player.id);
    if (isRomancePremiumActive(existing)) {
      return NextResponse.json(
        { error: "Use Manage Billing to change an active subscription." },
        { status: 409 }
      );
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    const successUrl = appUrl ? new URL("/romance", appUrl).toString() : undefined;

    const checkout = await polarApi<PolarCheckoutResponse>("/v1/checkouts/", {
      method: "POST",
      body: JSON.stringify({
        products: [getRomancePremiumPolarProductId()],
        external_customer_id: `romance:${player.id}`,
        customer_email: userEmail,
        success_url: successUrl,
        metadata: { romancePlayerId: player.id },
      }),
    });

    return NextResponse.json({ url: checkout.url });
  } catch (error) {
    captureServerError("romance-polar-checkout", error, { playerId: player.id });

    const message =
      error instanceof PolarConfigurationError || error instanceof PolarApiError
        ? error.message
        : "Unable to start checkout.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
