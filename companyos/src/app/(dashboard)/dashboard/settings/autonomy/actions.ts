"use server";

import { headers as nextHeaders } from "next/headers";
import { revalidatePath } from "next/cache";
import type { AutonomyLevel } from "@prisma/client";
import { requireActiveOrganization } from "@/server/auth/session";
import {
  updatePolicy,
  engageKillSwitch,
  disengageKillSwitch,
  addAllowlistEntry,
  removeAllowlistEntry,
} from "@/server/ai/autonomy/policy-service";
import type { ActionResult } from "@/app/(dashboard)/dashboard/members/actions";

/** The only domain with any tools registered as of Sprint 9 — see `MAX_AUTONOMY_LEVEL_BY_DOMAIN`. */
const DOMAIN = "crm";

/**
 * Sprint 10's first, and so far only, `autonomyEligible` tool. Hardcoded
 * rather than a free-text "allowlist any tool by name" field — the minimal
 * settings UI only needs to let an owner turn on the one pilot this sprint
 * ships, not manage an arbitrary allowlist surface.
 */
const PILOT_TOOL_NAME = "expire_stale_opportunity";

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

/**
 * Enables the Sprint 10 pilot tool for unattended L4/L5 execution — owner-only
 * (`autonomyPolicy:manage`, enforced inside `addAllowlistEntry`). This is
 * necessary but not sufficient on its own: the organization's `level` must
 * also be raised to L4+ and its daily action limit raised above zero below,
 * or `resolveAutonomyDecision` will still route every call to human approval.
 */
export async function enablePilotAllowlistAction(): Promise<ActionResult> {
  const { session, organization } = await requireActiveOrganization();

  try {
    await addAllowlistEntry({
      organizationId: organization.id,
      domain: DOMAIN,
      toolName: PILOT_TOOL_NAME,
      minLevelRequired: "L4",
      addedById: session.user.id,
      requestHeaders: await nextHeaders(),
    });
    revalidatePath("/dashboard/settings/autonomy");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to allowlist the pilot tool" };
  }
}

export async function disablePilotAllowlistAction(): Promise<ActionResult> {
  const { session, organization } = await requireActiveOrganization();

  try {
    await removeAllowlistEntry({
      organizationId: organization.id,
      domain: DOMAIN,
      toolName: PILOT_TOOL_NAME,
      removedById: session.user.id,
      requestHeaders: await nextHeaders(),
    });
    revalidatePath("/dashboard/settings/autonomy");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to remove the pilot tool from the allowlist" };
  }
}
