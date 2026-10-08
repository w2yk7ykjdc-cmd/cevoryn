import "server-only";

import { prisma } from "@/lib/prisma";

import { resolveSeasonForPlayer } from "../sessions/romance-session.service";

/**
 * Content-driven Story Library. The UI reads these rows - it never
 * hard-codes story metadata - so a second universe is an additional seed
 * (prisma/seed-romance.ts), not an application-logic change.
 */

export async function listPublishedUniverses() {
  return prisma.universe.findMany({
    where: { status: "PUBLISHED" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      version: true,
    },
    distinct: ["slug"],
  });
}

/**
 * `playerId` is optional so this still works for a not-yet-authenticated
 * preview context; when provided, shows the season the player is
 * actually on/next due for (resolveSeasonForPlayer) rather than always
 * season 1 - a returning player who finished season 1 sees season 2's
 * synopsis here, not a stale repeat of season 1's.
 */
export async function getPublishedUniverseDetail(slug: string, playerId?: string) {
  const universe = await prisma.universe.findFirst({
    where: { slug, status: "PUBLISHED" },
    orderBy: { version: "desc" },
  });
  if (!universe) return null;

  const [season, characters] = await Promise.all([
    playerId
      ? resolveSeasonForPlayer(playerId, universe.id)
      : prisma.season.findFirst({
          where: { universeId: universe.id, status: "PUBLISHED" },
          orderBy: { seasonNumber: "asc" },
        }),
    prisma.storyCharacter.findMany({
      where: { universeId: universe.id },
      orderBy: { slug: "asc" },
      select: { slug: true, name: true, isVoiced: true, race: true },
    }),
  ]);

  return { universe, season, characters };
}
