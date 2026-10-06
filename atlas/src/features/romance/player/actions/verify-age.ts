"use server";

import { redirect } from "next/navigation";

import { ROUTES } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import type { ActionResult } from "@/types";

import { requireRomancePlayer } from "../romance-player-guards";

/**
 * Self-attestation 18+ verification - the player confirms they are an
 * adult. This is NOT identity/document verification (that is explicitly
 * out of this milestone's scope - a real product would likely add a
 * third-party ID-verification provider behind its own interface later).
 * What matters for this milestone's security requirement is that the
 * resulting `ageVerifiedAt` timestamp is checked server-side on every
 * subsequent access (romance-player.service.ts), never trusted from the
 * client and never bypassable by hiding a button.
 */
export async function verifyAdultAction(input: {
  confirmedAdult: boolean;
}): Promise<ActionResult> {
  const { player } = await requireRomancePlayer();

  if (!input.confirmedAdult) {
    return {
      success: false,
      error: "You must confirm you are 18 or older to continue.",
    };
  }

  if (!player.ageVerifiedAt) {
    await prisma.romancePlayer.update({
      where: { id: player.id },
      data: { ageVerifiedAt: new Date() },
    });
  }

  redirect(ROUTES.ROMANCE_LIBRARY);
}
