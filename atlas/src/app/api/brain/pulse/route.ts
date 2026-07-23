import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  getPulseHistory,
  refreshDailyPulse,
} from "@/features/brain/pulse/pulse.service";
import {
  forbiddenResponse,
  internalErrorResponse,
  unauthorizedResponse,
} from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    const url = new URL(request.url);
    const mode = url.searchParams.get("mode");

    if (mode === "history") {
      const period =
        url.searchParams.get("period") === "WEEKLY" ? "WEEKLY" : "DAILY";
      const history = await getPulseHistory(
        membership.organizationId,
        period
      );
      return NextResponse.json({ data: history });
    }

    const metrics = await refreshDailyPulse(membership.organizationId);
    return NextResponse.json({ data: metrics });
  } catch (error) {
    return internalErrorResponse(
      "Pulse GET",
      error,
      "Failed to load pulse data"
    );
  }
}
