import { NextResponse } from "next/server";
import { z } from "zod";

import {
  badRequestResponse,
  forbiddenResponse,
  notFoundResponse,
  unauthorizedResponse,
} from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/rbac";

const updateOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(80),
});

export async function PATCH(request: Request) {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    if (!hasPermission(membership.role, "org:update")) {
      return forbiddenResponse("You do not have permission to update the organization");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch (_error) {
      return badRequestResponse("Invalid body");
    }

    const parsed = updateOrganizationSchema.safeParse(body);
    if (!parsed.success) {
      return badRequestResponse("Organization name must be between 2 and 80 characters");
    }

    const updated = await prisma.organization.updateMany({
      where: { id: membership.organizationId },
      data: { name: parsed.data.name },
    });

    if (updated.count === 0) return notFoundResponse("Organization not found");

    return NextResponse.json({ data: { name: parsed.data.name } });
  } catch (error) {
    console.error(
      "Organization update error:",
      error instanceof Error ? error.message : "unknown"
    );
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to update organization" } },
      { status: 500 }
    );
  }
}
