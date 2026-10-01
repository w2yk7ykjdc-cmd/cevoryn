import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { FeatureAccessError } from "@/features/billing/config/plans";
import {
  createProprietaryDataRecord,
  listProprietaryDataRecords,
  searchProprietaryDataRecords,
} from "@/features/enterprise/proprietary-data/proprietary-data.service";
import { createProprietaryDataRecordSchema } from "@/features/enterprise/proprietary-data/schemas";
import {
  badRequestResponse,
  forbiddenResponse,
  internalErrorResponse,
  unauthorizedResponse,
} from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { assertOrganizationFeatureAccess } from "@/server/services/entitlement.service";

export async function GET(request: NextRequest) {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    if (!hasPermission(membership.role, "radar:read")) {
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
              message:
                "Proprietary data requires the Professional or Business plan.",
            },
          },
          { status: 403 }
        );
      }
      throw error;
    }

    const query = new URL(request.url).searchParams.get("q")?.trim();
    const records = query
      ? await searchProprietaryDataRecords(membership.organizationId, query)
      : await listProprietaryDataRecords(membership.organizationId);

    return NextResponse.json({ data: records });
  } catch (error) {
    return internalErrorResponse(
      "ProprietaryData GET",
      error,
      "Failed to load proprietary data"
    );
  }
}

export async function POST(request: NextRequest) {
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
              message:
                "Proprietary data requires the Professional or Business plan.",
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

    const parsed = createProprietaryDataRecordSchema.safeParse(body);
    if (!parsed.success) return badRequestResponse("Invalid record");

    const record = await createProprietaryDataRecord(
      membership.organizationId,
      user.id,
      parsed.data
    );
    return NextResponse.json({ data: record }, { status: 201 });
  } catch (error) {
    return internalErrorResponse(
      "ProprietaryData POST",
      error,
      "Failed to add proprietary data record"
    );
  }
}
