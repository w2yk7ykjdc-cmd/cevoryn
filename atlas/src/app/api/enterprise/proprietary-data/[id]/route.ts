import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  deleteProprietaryDataRecord,
  updateProprietaryDataRecord,
} from "@/features/enterprise/proprietary-data/proprietary-data.service";
import { updateProprietaryDataRecordSchema } from "@/features/enterprise/proprietary-data/schemas";
import {
  badRequestResponse,
  forbiddenResponse,
  internalErrorResponse,
  notFoundResponse,
  unauthorizedResponse,
} from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";

import { requireRadarFeature } from "../require-radar-feature";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    if (!hasPermission(membership.role, "radar:manage")) {
      return forbiddenResponse("Insufficient permissions");
    }

    const featureError = await requireRadarFeature(membership.organizationId);
    if (featureError) return featureError;

    let body: unknown;
    try {
      body = await request.json();
    } catch (_error) {
      return badRequestResponse("Invalid body");
    }

    const parsed = updateProprietaryDataRecordSchema.safeParse(body);
    if (!parsed.success) return badRequestResponse("Invalid update");

    const result = await updateProprietaryDataRecord(
      membership.organizationId,
      id,
      parsed.data,
      user.id
    );
    if (result.count === 0) return notFoundResponse("Record not found");

    return NextResponse.json({ data: { id } });
  } catch (error) {
    return internalErrorResponse(
      "ProprietaryData PATCH",
      error,
      "Failed to update proprietary data record"
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    if (!hasPermission(membership.role, "radar:manage")) {
      return forbiddenResponse("Insufficient permissions");
    }

    const featureError = await requireRadarFeature(membership.organizationId);
    if (featureError) return featureError;

    const result = await deleteProprietaryDataRecord(
      membership.organizationId,
      id,
      user.id
    );
    if (result.count === 0) return notFoundResponse("Record not found");

    return NextResponse.json({ data: { id } });
  } catch (error) {
    return internalErrorResponse(
      "ProprietaryData DELETE",
      error,
      "Failed to delete proprietary data record"
    );
  }
}
