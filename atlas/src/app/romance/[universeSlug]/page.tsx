import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { StoryDetail } from "@/features/romance/library/components/story-detail";
import { getPublishedUniverseDetail } from "@/features/romance/library/romance-library.service";
import { requireAdultRomancePlayer } from "@/features/romance/player/romance-player-guards";
import { prisma } from "@/lib/prisma";

interface PageProps {
  params: Promise<{ universeSlug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { universeSlug } = await params;
  const detail = await getPublishedUniverseDetail(universeSlug);
  return { title: detail?.universe.name ?? "Story" };
}

export default async function StoryDetailPage({ params }: PageProps) {
  const { universeSlug } = await params;
  const { player } = await requireAdultRomancePlayer();

  const detail = await getPublishedUniverseDetail(universeSlug);
  if (!detail) notFound();

  const existingCharacter = await prisma.playerCharacter.findUnique({
    where: {
      playerId_universeId: { playerId: player.id, universeId: detail.universe.id },
    },
  });

  return (
    <StoryDetail
      universeSlug={detail.universe.slug}
      universeName={detail.universe.name}
      universeDescription={detail.universe.description}
      seasonName={detail.season?.name ?? null}
      seasonSynopsis={detail.season?.synopsis ?? null}
      characters={detail.characters}
      hasCharacter={!!existingCharacter}
    />
  );
}
