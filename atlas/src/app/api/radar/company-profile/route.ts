import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { FeatureAccessError } from "@/features/billing/config/plans";
import {
  getCompanyProfile,
  upsertCompanyProfile,
} from "@/features/radar/profile/company-profile.service";
import { upsertCompanyProfileSchema } from "@/features/radar/profile/schemas";
import {
  badRequestResponse,
  forbiddenResponse,
  internalErrorResponse,
  unauthorizedResponse,
} from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { assertOrganizationFeatureAccess } from "@/server/services/entitlement.service";

export async function GET(_request: NextRequest) {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    if (!hasPermission(membership.role, "radar:read")) {
      return forbiddenResponse("Insufficient permissions");
    }

    const profile = await getCompanyProfile(membership.organizationId);
    return NextResponse.json({ data: profile });
  } catch (error) {
    return internalErrorResponse(
      "CompanyProfile GET",
      error,
      "Failed to load company profile"
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    if (!hasPermission(membership.role, "radar:manage")) {
      return forbiddenResponse("Insufficient permissions");
    }

    try {
      await assertOrganizationFeatureAccess(membership.organizationId, "RADAR");
    } catch (error) {
      if (error instanceof FeatureAccessError) {
        return NextResponse.json(
          {
            error: {
              code: error.code,
              message: "Radar requires the Professional or Business plan.",
            },
          },
          { status: 403 }
        );
      }
      throw error;
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch (_error) {
      return badRequestResponse("Invalid body");
    }

    const parsed = upsertCompanyProfileSchema.safeParse(body);
    if (!parsed.success) return badRequestResponse("Invalid company profile");

    const profile = await upsertCompanyProfile(
      membership.organizationId,
      parsed.data
    );

    return NextResponse.json({ data: profile });
  } catch (error) {
    return internalErrorResponse(
      "CompanyProfile PUT",
      error,
      "Failed to save company profile"
    );
  }
}
