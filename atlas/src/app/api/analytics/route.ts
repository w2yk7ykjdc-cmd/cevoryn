import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import type { AnalyticsEventName } from "@/features/executive/types";
import { ANALYTICS_EVENTS } from "@/features/executive/types";
import { trackEvent } from "@/lib/analytics";
import { getMembership, getUser } from "@/lib/auth";

const VALID_EVENTS = new Set(Object.values(ANALYTICS_EVENTS));

export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) {
    return new NextResponse(null, { status: 401 });
  }

  const membership = await getMembership(user.id);
  if (!membership) {
    return new NextResponse(null, { status: 403 });
  }

  let body: {
    event?: string;
    metadata?: Record<string, string | number | boolean>;
  };
  try {
    body = await request.json();
  } catch (_error) {
    return new NextResponse(null, { status: 400 });
  }

  if (!body.event || !VALID_EVENTS.has(body.event as AnalyticsEventName)) {
    return new NextResponse(null, { status: 400 });
  }

  trackEvent({
    event: body.event as AnalyticsEventName,
    organizationId: membership.organizationId,
    userId: membership.userId,
    timestamp: new Date().toISOString(),
    metadata: body.metadata,
  });

  return new NextResponse(null, { status: 204 });
}
