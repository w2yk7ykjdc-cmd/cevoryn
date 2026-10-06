import "server-only";

import type { RomancePlayer } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { isPlausibleVerificationTimestamp } from "./age-gate-math";


/**
 * RomancePlayer bootstrap + the 18+ verification check itself. Pure data
 * layer, deliberately free of `next/navigation`/`@/lib/auth` imports (both
 * of which pull in client-navigation context code that cannot load outside
 * a real Next.js runtime) so this module stays directly testable with
 * real-Postgres integration tests. The actual auth-boundary functions
 * (requireRomancePlayer/requireAdultRomancePlayer/getAdultRomancePlayerOrThrow)
 * live in ./romance-player-guards.ts, which depends on this module, never
 * the other way around.
 */

function fallbackDisplayName(email: string): string {
  const prefix = email.split("@")[0]?.trim();
  return prefix && prefix.length > 0 ? prefix : "Player";
}

/**
 * Idempotent get-or-create. Romance has no separate signup/onboarding
 * flow (unlike the B2B product's forced "name your organization" step -
 * ADR-0001) - a RomancePlayer row is created lazily on first touch,
 * racing-safe via catch-and-reread on the unique `userId` constraint.
 */
export async function ensureRomancePlayer(
  userId: string,
  email: string
): Promise<RomancePlayer> {
  const existing = await prisma.romancePlayer.findUnique({ where: { userId } });
  if (existing) return existing;

  try {
    return await prisma.romancePlayer.create({
      data: { userId, displayName: fallbackDisplayName(email) },
    });
  } catch {
    const createdConcurrently = await prisma.romancePlayer.findUnique({
      where: { userId },
    });
    if (createdConcurrently) return createdConcurrently;
    throw new Error("Failed to create or load RomancePlayer.");
  }
}

export function isAdultVerified(
  player: Pick<RomancePlayer, "ageVerifiedAt">
): boolean {
  return isPlausibleVerificationTimestamp(player.ageVerifiedAt);
}
