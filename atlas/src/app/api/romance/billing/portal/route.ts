import { NextResponse } from "next/server";

import { getRomanceSubscription } from "@/features/romance/billing/romance-subscription.service";
import {
  getAdultRomancePlayerOrThrow,
  RomanceAgeNotVerifiedError,
  RomanceNotAuthenticatedError,
} from "@/features/romance/player/romance-player-guards";
import { tooManyRequestsResponse } from "@/lib/api-utils";
import { captureServerError } from "@/lib/error-reporting";
import { polarApi, PolarApiError, PolarConfigurationError } from "@/lib/polar/config";
import { tryRecordAuthAttempt } from "@/server/services/auth-rate-limit.service";

export const runtime = "nodejs";

type CustomerSessionResponse = {
  customer_portal_url: string;
};

export async function POST(): Promise<NextResponse> {
  let player: { id: string };
  try {
    ({ player } = await getAdultRomancePlayerOrThrow());
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

  if (!(await tryRecordAuthAttempt("romance_billing_portal", player.id))) {
    return tooManyRequestsResponse("Too many requests. Please try again shortly.");
  }

  try {
    const subscription = await getRomanceSubscription(player.id);
    if (!subscription?.providerCustomerId) {
      return NextResponse.json(
        { error: "No billing account exists for this player." },
        { status: 404 }
      );
    }

    const session = await polarApi<CustomerSessionResponse>("/v1/customer-sessions/", {
      method: "POST",
      body: JSON.stringify({ external_customer_id: `romance:${player.id}` }),
    });

    return NextResponse.json({ url: session.customer_portal_url });
  } catch (error) {
    captureServerError("romance-polar-portal", error, { playerId: player.id });
    return NextResponse.json(
      {
        error:
          error instanceof PolarConfigurationError || error instanceof PolarApiError
            ? error.message
            : "Unable to open billing management.",
      },
      { status: 500 }
    );
  }
}
