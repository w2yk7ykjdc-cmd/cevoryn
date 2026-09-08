"use server";

import { headers as nextHeaders } from "next/headers";
import { revalidatePath } from "next/cache";
import type { OutcomeType } from "@prisma/client";
import { requireActiveOrganization } from "@/server/auth/session";
import { confirmOutcome } from "@/server/intelligence/outcome/service";
import type { ActionResult } from "@/app/(dashboard)/dashboard/members/actions";

/**
 * The sole way a human can set an outcome's verdict from the UI --
 * RBAC-checked inside `confirmOutcome` itself (`outcome:confirm`), never
 * reachable from an AI tool. See `confirmOutcome`'s own doc comment for why
 * this boundary matters.
 */
export async function confirmOutcomeAction(
  outcomeId: string,
  outcomeType: OutcomeType,
  note?: string,
): Promise<ActionResult> {
  const { session, organization } = await requireActiveOrganization();

  try {
    await confirmOutcome({
      organizationId: organization.id,
      outcomeId,
      outcomeType,
      confirmedById: session.user.id,
      note,
      requestHeaders: await nextHeaders(),
    });
    revalidatePath("/dashboard/outcomes");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to confirm outcome" };
  }
}
