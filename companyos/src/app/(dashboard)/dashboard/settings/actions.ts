"use server";

import { headers as nextHeaders } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/server/auth/auth";
import { requirePermission, requireSession } from "@/server/auth/session";
import { recordAuditLog } from "@/server/audit/audit-log";
import { deleteOrganization } from "@/server/organizations/lifecycle";
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

/**
 * Permanently deletes the caller's active organization and every tenant
 * record it owns. Requires `organization:delete` (owner-only) and the
 * organization's own slug typed back as confirmation — see
 * `deleteOrganization` for the full safety contract (Stripe cancellation,
 * compliance record, cascade delete).
 */
export async function deleteOrganizationAction(confirmationSlug: string): Promise<ActionResult> {
  const { session, organization } = await requirePermission({ organization: ["delete"] });

  try {
    await deleteOrganization({
      organizationId: organization.id,
      actorId: session.user.id,
      confirmationSlug,
    });
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to delete workspace" };
  }

  redirect("/organizations");
}

/**
 * Permanently deletes the caller's own account. Blocked while they are the
 * sole owner of any organization (see `assertSafeToDeleteAccount`) — the
 * underlying `beforeDelete` hook on Better Auth's `deleteUser` enforces
 * this regardless of caller, this action is just the app's UI-facing path
 * to it.
 */
export async function deleteAccountAction(): Promise<ActionResult> {
  await requireSession();
  const headers = await nextHeaders();

  try {
    await auth.api.deleteUser({ headers, body: {} });
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to delete account" };
  }

  redirect("/login");
}
