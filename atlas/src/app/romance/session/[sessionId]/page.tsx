import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getAudioForStoryEvent } from "@/features/romance/audio/audio-render.service";
import { isRomancePremiumActive } from "@/features/romance/billing/entitlement-math";
import { getRomanceSubscription } from "@/features/romance/billing/romance-subscription.service";
import { requireAdultRomancePlayer } from "@/features/romance/player/romance-player-guards";
import { StorySessionScreen } from "@/features/romance/sessions/components/story-session-screen";
import { loadStoryContext } from "@/features/romance/sessions/romance-session.service";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Story" };

interface PageProps {
  params: Promise<{ sessionId: string }>;
}

interface StoredScenePayload {
  narration?: unknown;
  dialogueLines?: Array<{ speakerSlug?: unknown; text?: unknown }>;
}

function extractScene(payload: unknown): { narration: string; dialogueLines: { speakerSlug: string; text: string }[] } | null {
  if (typeof payload !== "object" || payload === null) return null;
  const scene = (payload as { scene?: StoredScenePayload }).scene;
  if (!scene || typeof scene.narration !== "string") return null;

  return {
    narration: scene.narration,
    dialogueLines: Array.isArray(scene.dialogueLines)
      ? scene.dialogueLines
          .filter(
            (line): line is { speakerSlug: string; text: string } =>
              typeof line?.speakerSlug === "string" && typeof line?.text === "string"
          )
          .map((line) => ({ speakerSlug: line.speakerSlug, text: line.text }))
      : [],
  };
}

export default async function StorySessionPage({ params }: PageProps) {
  const { sessionId } = await params;
  const { player } = await requireAdultRomancePlayer();

  const [context, subscription] = await Promise.all([
    loadStoryContext(player.id, sessionId),
    getRomanceSubscription(player.id),
  ]);
  if (!context) notFound();

  const { session, relationshipStates, recentResolvedEvents } = context;

  const characters = await prisma.storyCharacter.findMany({
    where: { universeId: session.universeId },
    select: { slug: true, name: true },
  });
  const characterNames = Object.fromEntries(characters.map((c) => [c.slug, c.name]));

  const availableCharacterSlugs = session.currentBeat?.characterInvolvement ?? [];

  const sceneEntries = recentResolvedEvents
    .slice()
    .reverse()
    .map((event) => ({ id: event.id, scene: extractScene(event.payload) }))
    .filter(
      (entry): entry is { id: string; scene: NonNullable<ReturnType<typeof extractScene>> } =>
        entry.scene !== null
    );

  // Audio renders happen out-of-band after the turn that generated them
  // (see submit-action.ts's after() call) - a scene fetched here may
  // already have completed audio for some/all lines, none, or (for a
  // scene the player just submitted this request) none yet. The player
  // sees text immediately either way; audio appears once it exists.
  const initialScenes = await Promise.all(
    sceneEntries.map(async (entry) => {
      const audioByLine = await getAudioForStoryEvent(entry.id);
      return {
        id: entry.id,
        ...entry.scene,
        audioByLine: Object.fromEntries(audioByLine),
      };
    })
  );

  const initialRelationships = Object.fromEntries(
    relationshipStates.map((state) => [
      state.characterSlug,
      {
        trust: state.trust,
        attraction: state.attraction,
        fear: state.fear,
        loyalty: state.loyalty,
        tension: state.tension,
      },
    ])
  );

  return (
    <StorySessionScreen
      storySessionId={session.id}
      beatName={session.currentBeat?.name ?? "The Story"}
      characterNames={characterNames}
      availableCharacterSlugs={availableCharacterSlugs}
      initialScenes={initialScenes}
      initialRelationships={initialRelationships}
      initialSessionCompleted={session.status === "COMPLETED"}
      isPremium={isRomancePremiumActive(subscription)}
    />
  );
}
