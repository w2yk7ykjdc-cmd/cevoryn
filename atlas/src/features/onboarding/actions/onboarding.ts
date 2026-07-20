"use server";

import { redirect } from "next/navigation";

import { getMembership, requireUser } from "@/lib/auth";
import { ROUTES } from "@/lib/constants";
import { createOrganization } from "@/server/services/organization.service";
import type { ActionResult } from "@/types";

import { onboardingSchema } from "../schemas/onboarding";
import type { OnboardingInput } from "../schemas/onboarding";

export async function completeOnboardingAction(
  input: OnboardingInput
): Promise<ActionResult> {
  const user = await requireUser();

  // Guard: prevent duplicate org creation
  const existing = await getMembership(user.id);
  if (existing) {
    redirect(ROUTES.DASHBOARD);
  }

  const parsed = onboardingSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<
        string,
        string[]
      >,
    };
  }

  try {
    await createOrganization({
      name: parsed.data.organizationName,
      createdByUserId: user.id,
      displayName: parsed.data.displayName,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Onboarding error:", message);

    if (message === "User already belongs to an organization") {
      redirect(ROUTES.DASHBOARD);
    }

    return {
      success: false,
      error: "Failed to create organization. Please try again.",
    };
  }

  redirect(ROUTES.DASHBOARD);
}
