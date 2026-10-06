import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { VerifyAgeForm } from "@/features/romance/player/components/verify-age-form";
import { requireRomancePlayer } from "@/features/romance/player/romance-player-guards";
import { isAdultVerified } from "@/features/romance/player/romance-player.service";
import { ROUTES } from "@/lib/constants";

export const metadata: Metadata = { title: "Age verification" };

export default async function VerifyAgePage() {
  const { player } = await requireRomancePlayer();

  if (isAdultVerified(player)) {
    redirect(ROUTES.ROMANCE_LIBRARY);
  }

  return <VerifyAgeForm />;
}
