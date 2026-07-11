import type { Metadata } from "next";

import { requireUser } from "@/lib/auth";
import { OnboardingForm } from "@/features/onboarding/components/onboarding-form";

export const metadata: Metadata = { title: "Set up your workspace" };

export default async function OnboardingPage() {
  const user = await requireUser();

  return <OnboardingForm userEmail={user.email} />;
}
