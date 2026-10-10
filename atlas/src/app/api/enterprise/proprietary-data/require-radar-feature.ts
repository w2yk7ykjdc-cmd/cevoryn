import type { NextResponse } from "next/server";

import { assertOrganizationFeatureAccess } from "@/server/services/entitlement.service";

import { translateRadarFeatureError } from "./radar-feature-error";

/**
 * Gate access to proprietary-data endpoints behind the RADAR billing
 * feature. Returns a 403 response if the organization's plan doesn't
 * include RADAR, or null if the caller may proceed. Shared by every
 * proprietary-data route (GET/POST in route.ts, PATCH/DELETE in
 * [id]/route.ts) so the check-and-translate logic exists in one place.
 */
export async function requireRadarFeature(
  organizationId: string
): Promise<NextResponse | null> {
  try {
    await assertOrganizationFeatureAccess(organizationId, "RADAR");
    return null;
  } catch (error) {
    return translateRadarFeatureError(error);
  }
}
