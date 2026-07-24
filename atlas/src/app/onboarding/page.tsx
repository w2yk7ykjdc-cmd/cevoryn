import type { Metadata } from "next";

import { OnboardingForm } from "@/features/onboarding/components/onboarding-form";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Set up your workspace" };

export default async function OnboardingPage() {
  const user = await requireUser();

  return <OnboardingForm userEmail={user.email} />;
}
