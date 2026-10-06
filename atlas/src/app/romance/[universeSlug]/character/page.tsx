import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CreateCharacterForm } from "@/features/romance/characters/components/create-character-form";
import { getPublishedUniverseDetail } from "@/features/romance/library/romance-library.service";
import { requireAdultRomancePlayer } from "@/features/romance/player/romance-player-guards";

export const metadata: Metadata = { title: "Create your character" };

interface PageProps {
  params: Promise<{ universeSlug: string }>;
}

export default async function CreateCharacterPage({ params }: PageProps) {
  const { universeSlug } = await params;
  await requireAdultRomancePlayer();

  const detail = await getPublishedUniverseDetail(universeSlug);
  if (!detail) notFound();

  return <CreateCharacterForm universeSlug={universeSlug} />;
}
