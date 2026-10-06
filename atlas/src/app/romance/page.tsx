import type { Metadata } from "next";

import { StoryLibraryGrid } from "@/features/romance/library/components/story-library-grid";
import { listPublishedUniverses } from "@/features/romance/library/romance-library.service";
import { requireAdultRomancePlayer } from "@/features/romance/player/romance-player-guards";

export const metadata: Metadata = { title: "Story Library" };

export default async function RomanceLibraryPage() {
  await requireAdultRomancePlayer();
  const universes = await listPublishedUniverses();

  return <StoryLibraryGrid universes={universes} />;
}
