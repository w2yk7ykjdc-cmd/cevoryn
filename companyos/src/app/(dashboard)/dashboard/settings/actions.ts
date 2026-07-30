"use server";

import { headers as nextHeaders } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/server/auth/auth";
import { requirePermission } from "@/server/auth/session";
import { recordAuditLog } from "@/server/audit/audit-log";
import type { ActionResult } from "@/app/(dashboard)/dashboard/members/actions";

export async function updateOrganizationAction(name: string): Promise<ActionResult> {
  const { session, organization } = await requirePermission({ organization: ["update"] });
  const headers = await nextHeaders();

  try {
    await auth.api.updateOrganization({
      headers,
      body: { organizationId: organization.id, data: { name } },
    });

    await recordAuditLog({
      organizationId: organization.id,
      actorId: session.user.id,
      actorType: "user",
      action: "organization.updated",
      targetType: "organization",
      targetId: organization.id,
      metadata: { name },
    });

    revalidatePath("/dashboard/settings");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to update workspace" };
  }
}
