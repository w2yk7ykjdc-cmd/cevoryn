"use server";

import { z } from "zod";

import { prisma } from "@/lib/prisma";
import type { ActionResult } from "@/types";

import { getAdultRomancePlayerOrThrow } from "../../player/romance-player-guards";
import { startOrResumeStorySession } from "../romance-session.service";

const startStorySessionSchema = z.object({
  universeSlug: z.string().trim().min(1),
});

export async function startStorySessionAction(
  input: z.infer<typeof startStorySessionSchema>
): Promise<ActionResult<{ storySessionId: string }>> {
  const { player } = await getAdultRomancePlayerOrThrow();

  const parsed = startStorySessionSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid story selection." };
  }

  const universe = await prisma.universe.findFirst({
    where: { slug: parsed.data.universeSlug, status: "PUBLISHED" },
    orderBy: { version: "desc" },
  });
  if (!universe) {
    return { success: false, error: "This story could not be found." };
  }

  const playerCharacter = await prisma.playerCharacter.findUnique({
    where: { playerId_universeId: { playerId: player.id, universeId: universe.id } },
  });
  if (!playerCharacter) {
    return { success: false, error: "Create a character before starting this story." };
  }

  const session = await startOrResumeStorySession(
    player.id,
    parsed.data.universeSlug,
    playerCharacter.id
  );

  return { success: true, data: { storySessionId: session.id } };
}
