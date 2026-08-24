"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import {
  cancelSubscriptionForOrg,
  createBillingPortalSessionForOrg,
  createCheckoutSessionForOrg,
} from "@/server/billing/subscription";
import type { ActionResult } from "@/app/(dashboard)/dashboard/members/actions";

export type RedirectActionResult = { success: true; url: string } | { success: false; error: string };

/** Starts a Stripe Checkout session to upgrade to `tier`. `billing:manage` only — a viewer/admin-view-only cannot spend the org's money. */
export async function startCheckoutAction(tier: "pro" | "enterprise"): Promise<RedirectActionResult> {
  const { session, organization } = await requirePermission({ billing: ["manage"] });

  try {
    const { url } = await createCheckoutSessionForOrg({
      organizationId: organization.id,
      actorEmail: session.user.email,
      tier,
    });
    return { success: true, url };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to start checkout" };
  }
}

export async function openBillingPortalAction(): Promise<RedirectActionResult> {
  const { organization } = await requirePermission({ billing: ["manage"] });

  try {
    const { url } = await createBillingPortalSessionForOrg(organization.id);
    return { success: true, url };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to open the billing portal" };
  }
}

export async function cancelSubscriptionAction(): Promise<ActionResult> {
  const { session, organization } = await requirePermission({ billing: ["manage"] });

  try {
    await cancelSubscriptionForOrg(organization.id, session.user.id);
    revalidatePath("/dashboard/settings/billing");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to cancel the subscription" };
  }
}
