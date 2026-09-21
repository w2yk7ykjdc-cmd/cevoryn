import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { FeatureAccessError } from "@/features/billing/config/plans";
import {
  DuplicateEntityError,
  createWatchedEntity,
  listWatchedEntities,
} from "@/features/radar/entities/entity.service";
import { createExternalEntitySchema } from "@/features/radar/entities/schemas";
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
              message: "Radar requires the Professional or Business plan.",
            },
          },
          { status: 403 }
        );
      }
      throw error;
    }

    const includeInactive =
      new URL(request.url).searchParams.get("includeInactive") === "true";
    const entities = await listWatchedEntities(membership.organizationId, {
      includeInactive,
    });

    return NextResponse.json({ data: entities });
  } catch (error) {
    return internalErrorResponse(
      "Entities GET",
      error,
      "Failed to load watchlist"
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

    const parsed = createExternalEntitySchema.safeParse(body);
    if (!parsed.success) return badRequestResponse("Invalid entity");

    try {
      const entity = await createWatchedEntity(
        membership.organizationId,
        user.id,
        parsed.data
      );
      return NextResponse.json({ data: entity }, { status: 201 });
    } catch (error) {
      if (error instanceof DuplicateEntityError) {
        return NextResponse.json(
          { error: { code: "DUPLICATE_ENTITY", message: error.message } },
          { status: 409 }
        );
      }
      throw error;
    }
  } catch (error) {
    return internalErrorResponse(
      "Entities POST",
      error,
      "Failed to add company to watchlist"
    );
  }
}
