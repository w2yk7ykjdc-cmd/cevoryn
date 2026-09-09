"use server";

import { headers as nextHeaders } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireActiveOrganization, requirePermission } from "@/server/auth/session";
import { engageKillSwitch, disengageKillSwitch } from "@/server/ai/autonomy/policy-service";
import { enableAutonomousExecution, disableAutonomousExecution } from "@/server/execution/autonomy-gate";
import { setOrganizationRiskPolicy, type RiskPolicyLimits } from "@/server/execution/risk-policy";
import { setOrganizationCredentials, revokeOrganizationCredentials } from "@/server/execution/org-credentials";
import { isSupportedExecutionProvider } from "@/server/execution/providers";
import { reactivateStrategy, StrategyHealthNotFoundError, StrategyHealthNotReactivatableError } from "@/server/intelligence/learning/strategy-health";
import type { ActionResult } from "@/app/(dashboard)/dashboard/members/actions";

/**
 * Sprint 28: server actions for the Trading Controls page -- the
 * human-only control plane wiring up five already-built, already-tested
 * services (Sprint 9/19 kill switch, Sprint 25 execution autonomy gate,
 * Sprint 24 risk policy, Sprint 23/27 credentials, Sprint 26 strategy
 * health) that previously had zero UI surface. No new business logic --
 * every action below is a thin RBAC-gated wrapper around an existing,
 * unmodified service function. No AI tool imports from this file or calls
 * any of these actions.
 */

const MARKET_DOMAIN = "market";
const REVALIDATE_PATH = "/dashboard/settings/trading";

export async function engageMarketKillSwitchAction(): Promise<ActionResult> {
  const { session, organization } = await requireActiveOrganization();
  try {
    await engageKillSwitch({
      organizationId: organization.id,
      domain: MARKET_DOMAIN,
      actorId: session.user.id,
      requestHeaders: await nextHeaders(),
    });
    revalidatePath(REVALIDATE_PATH);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to engage the market kill switch" };
  }
}

export async function disengageMarketKillSwitchAction(): Promise<ActionResult> {
  const { session, organization } = await requireActiveOrganization();
  try {
    await disengageKillSwitch({
      organizationId: organization.id,
      domain: MARKET_DOMAIN,
      actorId: session.user.id,
      requestHeaders: await nextHeaders(),
    });
    revalidatePath(REVALIDATE_PATH);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to disengage the market kill switch" };
  }
}

export async function setExecutionAutonomyAction(enabled: boolean): Promise<ActionResult> {
  const { session, organization } = await requirePermission({ executionAutonomy: ["manage"] });
  try {
    if (enabled) {
      await enableAutonomousExecution({ organizationId: organization.id, actorId: session.user.id });
    } else {
      await disableAutonomousExecution({ organizationId: organization.id, actorId: session.user.id, reason: "disabled from Trading Controls settings" });
    }
    revalidatePath(REVALIDATE_PATH);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to update execution autonomy" };
  }
}

export async function updateRiskPolicyAction(policy: Partial<RiskPolicyLimits>): Promise<ActionResult> {
  const { session, organization } = await requirePermission({ riskPolicy: ["manage"] });
  try {
    await setOrganizationRiskPolicy({ organizationId: organization.id, actorId: session.user.id, policy });
    revalidatePath(REVALIDATE_PATH);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to update the risk policy" };
  }
}

export type ConfigureCredentialsInput = { provider: string; apiKey: string; apiSecret: string };

export async function configureCredentialsAction(input: ConfigureCredentialsInput): Promise<ActionResult> {
  const { session, organization } = await requirePermission({ executionCredential: ["manage"] });

  if (!isSupportedExecutionProvider(input.provider)) {
    return { success: false, error: `"${input.provider}" is not a supported execution provider` };
  }
  const apiKey = input.apiKey.trim();
  const apiSecret = input.apiSecret.trim();
  if (!apiKey || !apiSecret) {
    return { success: false, error: "API key and secret are both required" };
  }

  try {
    await setOrganizationCredentials({ organizationId: organization.id, actorId: session.user.id, apiKey, apiSecret, provider: input.provider });
    revalidatePath(REVALIDATE_PATH);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to save credentials" };
  }
}

export async function revokeCredentialsAction(provider: string): Promise<ActionResult> {
  const { session, organization } = await requirePermission({ executionCredential: ["revoke"] });
  try {
    await revokeOrganizationCredentials(organization.id, session.user.id, provider);
    revalidatePath(REVALIDATE_PATH);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to revoke credentials" };
  }
}

export async function reactivateStrategyAction(strategyType: string): Promise<ActionResult> {
  const { session, organization } = await requirePermission({ strategyHealth: ["manage"] });
  try {
    await reactivateStrategy({ organizationId: organization.id, strategyType, actorId: session.user.id });
    revalidatePath(REVALIDATE_PATH);
    return { success: true };
  } catch (err) {
    if (err instanceof StrategyHealthNotFoundError || err instanceof StrategyHealthNotReactivatableError) {
      return { success: false, error: err.message };
    }
    return { success: false, error: err instanceof Error ? err.message : "Failed to reactivate strategy" };
  }
}
