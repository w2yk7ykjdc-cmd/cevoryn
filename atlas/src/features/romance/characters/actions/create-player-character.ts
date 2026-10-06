"use server";

import { z } from "zod";

import { prisma } from "@/lib/prisma";
import type { ActionResult } from "@/types";

import { getAdultRomancePlayerOrThrow } from "../../player/romance-player-guards";

const createPlayerCharacterSchema = z.object({
  universeSlug: z.string().trim().min(1),
  name: z.string().trim().min(1).max(60),
  pronouns: z.string().trim().min(1).max(30),
  appearanceNotes: z.string().trim().max(500).optional(),
});

export type CreatePlayerCharacterInput = z.infer<typeof createPlayerCharacterSchema>;

/**
 * First usable player-character creation flow (deliberately small per
 * the milestone's own scope note - "do not build an unnecessarily large
 * character creator yet"). What matters is that the result is persistent
 * Story state the Story Engine can read (PlayerCharacter row), not the
 * breadth of the form.
 */
export async function createPlayerCharacterAction(
  input: CreatePlayerCharacterInput
): Promise<ActionResult<{ playerCharacterId: string }>> {
  const { player } = await getAdultRomancePlayerOrThrow();

  const parsed = createPlayerCharacterSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Please check your character details.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const universe = await prisma.universe.findFirst({
    where: { slug: parsed.data.universeSlug, status: "PUBLISHED" },
    orderBy: { version: "desc" },
  });
  if (!universe) {
    return { success: false, error: "This story could not be found." };
  }

  const existing = await prisma.playerCharacter.findUnique({
    where: { playerId_universeId: { playerId: player.id, universeId: universe.id } },
  });
  if (existing) {
    return { success: true, data: { playerCharacterId: existing.id } };
  }

  const created = await prisma.playerCharacter.create({
    data: {
      playerId: player.id,
      universeId: universe.id,
      name: parsed.data.name,
      pronouns: parsed.data.pronouns,
      appearanceNotes: parsed.data.appearanceNotes ?? null,
    },
  });

  return { success: true, data: { playerCharacterId: created.id } };
}
