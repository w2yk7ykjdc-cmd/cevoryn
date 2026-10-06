"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { startStorySessionAction } from "../../sessions/actions/start-session";

interface StoryDetailCharacter {
  slug: string;
  name: string;
  isVoiced: boolean;
}

interface StoryDetailProps {
  universeSlug: string;
  universeName: string;
  universeDescription: string;
  seasonName: string | null;
  seasonSynopsis: string | null;
  characters: StoryDetailCharacter[];
  hasCharacter: boolean;
}

export function StoryDetail({
  universeSlug,
  universeName,
  universeDescription,
  seasonName,
  seasonSynopsis,
  characters,
  hasCharacter,
}: StoryDetailProps) {
  const router = useRouter();
  const [isEntering, setIsEntering] = useState(false);

  async function handleEnterStory() {
    setIsEntering(true);
    try {
      const result = await startStorySessionAction({ universeSlug });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      router.push(`/romance/session/${result.data.storySessionId}`);
    } finally {
      setIsEntering(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl text-[#f1e9f4]">{universeName}</h1>
        <p className="mt-2 text-[#c9b8d4]">{universeDescription}</p>
      </div>

      {seasonName && (
        <div className="rounded-lg border border-white/10 bg-[#1c1024]/70 p-4">
          <h2 className="font-serif text-lg text-[#f1e9f4]">{seasonName}</h2>
          {seasonSynopsis && <p className="mt-1 text-sm text-[#c9b8d4]">{seasonSynopsis}</p>}
        </div>
      )}

      {characters.length > 0 && (
        <div>
          <h3 className="text-sm font-medium uppercase tracking-wide text-[#a08bb0]">
            Who you&apos;ll meet
          </h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {characters.map((character) => (
              <li
                key={character.slug}
                className="rounded-full border border-white/10 bg-[#1c1024]/70 px-3 py-1 text-sm text-[#e4d9ea]"
              >
                {character.name}
                {!character.isVoiced && (
                  <span className="ml-1 text-[#a08bb0]">(text only)</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasCharacter ? (
        <Button
          onClick={handleEnterStory}
          disabled={isEntering}
          className="w-full bg-[#5c3a73] text-white hover:bg-[#6d4788] sm:w-auto"
        >
          {isEntering && <Loader2 className="animate-spin" />}
          Continue the story
        </Button>
      ) : (
        <Button asChild className="w-full bg-[#5c3a73] text-white hover:bg-[#6d4788] sm:w-auto">
          <Link href={`/romance/${universeSlug}/character`}>Create your character</Link>
        </Button>
      )}
    </div>
  );
}
