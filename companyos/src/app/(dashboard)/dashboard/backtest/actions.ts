"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { createBacktestRun } from "@/server/intelligence/backtest/run-service";
import type { ActionResult } from "@/app/(dashboard)/dashboard/members/actions";

/**
 * Launches a new named, persisted backtest scenario (Sprint 21) --
 * `backtest:run` permission enforced here (an owner/admin/member can
 * launch a run, a viewer cannot, matching `permissions.ts`'s own role
 * grants). Parses the plain `FormData` a `<form action={...}>` submission
 * carries -- no client-side JavaScript/state required for this first
 * version of the launch form.
 */
export async function createBacktestRunAction(formData: FormData): Promise<ActionResult> {
  const { session, organization } = await requirePermission({ backtest: ["run"] });

  const label = String(formData.get("label") ?? "").trim();
  const symbolsRaw = String(formData.get("symbols") ?? "");
  const symbols = symbolsRaw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length > 0);
  const windowDays = Number(formData.get("windowDays"));

  try {
    await createBacktestRun({
      organizationId: organization.id,
      label,
      symbols,
      windowDays,
      requestedById: session.user.id,
    });
    revalidatePath("/dashboard/backtest");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to launch backtest run" };
  }
}
