"use server";

import { headers as nextHeaders } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/server/auth/auth";
import { requirePermission } from "@/server/auth/session";
import { recordAuditLog } from "@/server/audit/audit-log";
import { publishEvent } from "@/server/events/event-bus";
import { SeatLimitExceededError, withSeatLimitLock } from "@/server/billing/seats";

export type ActionResult =
  | { success: true }
  | { success: false; error: string; code?: "seat_limit_exceeded" };

export async function inviteMemberAction(
  email: string,
  role: string,
): Promise<ActionResult> {
  const { session, organization } = await requirePermission({ invitation: ["create"] });
  const headers = await nextHeaders();

  try {
    const invitation = await withSeatLimitLock(organization.id, () =>
      auth.api.createInvitation({
        headers,
        body: { email, role, organizationId: organization.id },
      }),
    );

    await recordAuditLog({
      organizationId: organization.id,
      actorId: session.user.id,
      actorType: "user",
      action: "member.invited",
      targetType: "invitation",
      targetId: invitation.id,
      metadata: { email, role },
    });

    revalidatePath("/dashboard/members");
    return { success: true };
  } catch (err) {
    if (err instanceof SeatLimitExceededError) {
      return { success: false, error: err.message, code: "seat_limit_exceeded" };
    }
    return { success: false, error: err instanceof Error ? err.message : "Failed to send invitation" };
  }
}

export async function updateMemberRoleAction(
  memberId: string,
  newRole: string,
): Promise<ActionResult> {
  const { session, organization } = await requirePermission({ member: ["update"] });
  const headers = await nextHeaders();

  try {
    const result = await auth.api.updateMemberRole({
      headers,
      body: { memberId, role: newRole, organizationId: organization.id },
    });

    await recordAuditLog({
      organizationId: organization.id,
      actorId: session.user.id,
      actorType: "user",
      action: "member.role_changed",
      targetType: "member",
      targetId: memberId,
      metadata: { newRole },
    });

    await publishEvent(
      "organization.member.role_changed",
      {
        organizationId: organization.id,
        memberId,
        userId: result.userId,
        previousRole: "",
        newRole,
        changedById: session.user.id,
      },
      { organizationId: organization.id },
    );

    revalidatePath("/dashboard/members");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to update role" };
  }
}

export async function removeMemberAction(memberIdOrEmail: string): Promise<ActionResult> {
  const { session, organization } = await requirePermission({ member: ["delete"] });
  const headers = await nextHeaders();

  try {
    await auth.api.removeMember({
      headers,
      body: { memberIdOrEmail, organizationId: organization.id },
    });

    await recordAuditLog({
      organizationId: organization.id,
      actorId: session.user.id,
      actorType: "user",
      action: "member.removed",
      targetType: "member",
      targetId: memberIdOrEmail,
      metadata: {},
    });

    revalidatePath("/dashboard/members");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to remove member" };
  }
}
