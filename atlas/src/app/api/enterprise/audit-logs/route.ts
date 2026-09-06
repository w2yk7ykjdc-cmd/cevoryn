import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { listAuditLogs } from "@/features/enterprise/audit/audit.service";
import {
  forbiddenResponse,
  internalErrorResponse,
  unauthorizedResponse,
} from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";
import { isRoleAtLeast } from "@/lib/rbac";

/**
 * Enterprise audit trail view. Admin-only (not gated behind a Radar
 * permission - audit events span both Radar and Brain mutations), scoped
 * to the caller's own organization only.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    if (!isRoleAtLeast(membership.role, "ADMIN")) {
      return forbiddenResponse(
        "Only organization owners and admins can view the audit log"
      );
    }

    const url = new URL(request.url);
    const resourceType = url.searchParams.get("resourceType") ?? undefined;
    const resourceId = url.searchParams.get("resourceId") ?? undefined;
    const takeParam = Number(url.searchParams.get("take"));
    const take = Number.isFinite(takeParam) && takeParam > 0 ? takeParam : 50;

    const logs = await listAuditLogs(membership.organizationId, {
      resourceType,
      resourceId,
      take,
    });

    return NextResponse.json({ data: logs });
  } catch (error) {
    return internalErrorResponse(
      "AuditLogs GET",
      error,
      "Failed to load audit log"
    );
  }
}
