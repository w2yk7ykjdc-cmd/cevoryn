"use server";

import { headers as nextHeaders } from "next/headers";
import { revalidatePath } from "next/cache";
import type { AutonomyLevel } from "@prisma/client";
import { requireActiveOrganization } from "@/server/auth/session";
import { updatePolicy, engageKillSwitch, disengageKillSwitch } from "@/server/ai/autonomy/policy-service";
import type { ActionResult } from "@/app/(dashboard)/dashboard/members/actions";

/** The only domain with any tools registered as of Sprint 9 — see `MAX_AUTONOMY_LEVEL_BY_DOMAIN`. */
const DOMAIN = "crm";

export type UpdateAutonomyPolicyInput = {
  level: AutonomyLevel;
  dailyActionLimit: number;
  dailyRiskLimit: number;
  perActionRiskLimit: number;
};

export async function updateAutonomyPolicyAction(input: UpdateAutonomyPolicyInput): Promise<ActionResult> {
  const { session, organization } = await requireActiveOrganization();

  try {
    await updatePolicy({
      organizationId: organization.id,
      domain: DOMAIN,
      level: input.level,
      dailyActionLimit: input.dailyActionLimit,
      dailyRiskLimit: input.dailyRiskLimit,
      perActionRiskLimit: input.perActionRiskLimit,
      changedById: session.user.id,
      requestHeaders: await nextHeaders(),
    });
    revalidatePath("/dashboard/settings/autonomy");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to update autonomy policy" };
  }
}

export async function engageKillSwitchAction(): Promise<ActionResult> {
  const { session, organization } = await requireActiveOrganization();

  try {
    await engageKillSwitch({
      organizationId: organization.id,
      domain: DOMAIN,
      actorId: session.user.id,
      requestHeaders: await nextHeaders(),
    });
    revalidatePath("/dashboard/settings/autonomy");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to engage the kill switch" };
  }
}

export async function disengageKillSwitchAction(): Promise<ActionResult> {
  const { session, organization } = await requireActiveOrganization();

  try {
    await disengageKillSwitch({
      organizationId: organization.id,
      domain: DOMAIN,
      actorId: session.user.id,
      requestHeaders: await nextHeaders(),
    });
    revalidatePath("/dashboard/settings/autonomy");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to disengage the kill switch" };
  }
}
