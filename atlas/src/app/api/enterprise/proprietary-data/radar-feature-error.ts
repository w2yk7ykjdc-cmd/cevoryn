import { NextResponse } from "next/server";

import { FeatureAccessError } from "@/features/billing/config/plans";

/**
 * Translate the outcome of the RADAR feature-access check into a
 * response. Kept in its own module, free of entitlement.service.ts's
 * "server-only" import, so it's directly unit-testable under plain
 * `node:test` - the same "pure logic + server-only wrapper" split used
 * elsewhere in this codebase (e.g. auth-rate-limit.ts vs
 * auth-rate-limit.service.ts). assertOrganizationFeatureAccess itself
 * already has its own DB-backed coverage
 * (test/integration/radar-billing-gate.integration.ts); this is the thin
 * translation layer around it that previously had none.
 */
export function translateRadarFeatureError(error: unknown): NextResponse {
  if (error instanceof FeatureAccessError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: "Proprietary data requires the Professional or Business plan.",
        },
      },
      { status: 403 }
    );
  }
  throw error;
}
