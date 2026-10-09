import "server-only";

import { captureServerError } from "@/lib/error-reporting";
import { prisma } from "@/lib/prisma";

import type { AudioStorageProvider } from "./audio-storage-provider";
import { getAudioStorageProvider, getTTSProvider } from "./providers";
import type { TTSProvider } from "./tts-provider";

export interface DialogueLineForRender {
  speakerSlug: string;
  text: string;
}

/**
 * Renders audio for one scene's dialogue lines, best-effort and
 * idempotent. Per brief §12/§20: this is never called synchronously in
 * the request path that commits story state (see romance-story.service.ts,
 * which schedules this via next/server's after() so a slow/failed render
 * can never lose or delay the player's turn) - a failure here is logged
 * on the AudioRender row and never surfaces to the player as a broken
 * session. Only characters with isVoiced=true and a configured
 * VoiceProfile get rendered; everyone else (Wren, in Season 1) is
 * text-only by design, not a missing feature.
 */
export async function renderSceneAudio(params: {
  storyEventId: string;
  universeId: string;
  dialogueLines: DialogueLineForRender[];
  ttsProvider?: TTSProvider;
  storageProvider?: AudioStorageProvider;
}): Promise<void> {
  const ttsProvider = params.ttsProvider ?? getTTSProvider();
  const storageProvider = params.storageProvider ?? getAudioStorageProvider();

  for (let lineIndex = 0; lineIndex < params.dialogueLines.length; lineIndex++) {
    const line = params.dialogueLines[lineIndex]!;

    try {
      const character = await prisma.storyCharacter.findFirst({
        where: { universeId: params.universeId, slug: line.speakerSlug },
        select: { id: true, isVoiced: true },
      });
      if (!character?.isVoiced) continue;

      const voiceProfile = await prisma.voiceProfile.findUnique({
        where: { characterId: character.id },
      });
      if (!voiceProfile || voiceProfile.provider === "unconfigured") continue;

      const existing = await prisma.audioRender.findUnique({
        where: {
          storyEventId_lineIndex_voiceProfileId_voiceProfileVersion: {
            storyEventId: params.storyEventId,
            lineIndex,
            voiceProfileId: voiceProfile.id,
            voiceProfileVersion: voiceProfile.version,
          },
        },
      });
      if (existing && existing.status !== "FAILED") continue;

      const render = existing
        ? await prisma.audioRender.update({
            where: { id: existing.id },
            data: { status: "PROCESSING", failureReason: null },
          })
        : await prisma.audioRender.create({
            data: {
              storyEventId: params.storyEventId,
              lineIndex,
              voiceProfileId: voiceProfile.id,
              voiceProfileVersion: voiceProfile.version,
              status: "PROCESSING",
            },
          });

      try {
        const speech = await ttsProvider.synthesizeSpeech(line.text, voiceProfile.providerVoiceId);
        const storagePath = `${params.storyEventId}/${lineIndex}-${voiceProfile.id}-v${voiceProfile.version}.${speech.format}`;
        const uploaded = await storageProvider.uploadAudio(storagePath, speech.audioBase64, speech.format);

        const audioAsset = await prisma.audioAsset.create({
          data: {
            storagePath: uploaded.storagePath,
            durationMs: speech.approximateDurationMs,
            format: speech.format,
          },
        });

        await prisma.audioRender.update({
          where: { id: render.id },
          data: { status: "COMPLETED", audioAssetId: audioAsset.id },
        });
      } catch (error) {
        await prisma.audioRender.update({
          where: { id: render.id },
          data: {
            status: "FAILED",
            failureReason: error instanceof Error ? error.message.slice(0, 500) : "unknown error",
          },
        });
        captureServerError("romance-audio-render", error, {
          storyEventId: params.storyEventId,
          lineIndex,
          voiceProfileId: voiceProfile.id,
        });
      }
    } catch (error) {
      // A failure resolving the character/voice profile (not the render
      // itself) - log and move on to the next line; never let one
      // line's lookup failure break the rest of the scene's audio.
      captureServerError("romance-audio-render-lookup", error, {
        storyEventId: params.storyEventId,
        lineIndex,
      });
    }
  }
}

export type AudioLineStatus =
  | { status: "COMPLETED"; playbackUrl: string; durationMs: number }
  | { status: "FAILED" };

/**
 * Read side - the audio status (if any) for a StoryEvent's dialogue lines,
 * keyed by line index. COMPLETED lines carry a fresh signed playback URL;
 * FAILED lines carry no URL (nothing was ever stored) so the player can be
 * told honestly that voiced audio was attempted and didn't come through,
 * instead of the line silently looking like it was never voiced at all.
 * PROCESSING/absent lines are omitted - the player just sees text, same as
 * before a render completes.
 */
export async function getAudioForStoryEvent(
  storyEventId: string,
  storageProvider: AudioStorageProvider = getAudioStorageProvider()
): Promise<Map<number, AudioLineStatus>> {
  const renders = await prisma.audioRender.findMany({
    where: { storyEventId, status: { in: ["COMPLETED", "FAILED"] } },
    include: { audioAsset: true },
  });

  const result = new Map<number, AudioLineStatus>();
  for (const render of renders) {
    if (render.status === "FAILED") {
      result.set(render.lineIndex, { status: "FAILED" });
      continue;
    }
    if (!render.audioAsset) continue;
    const playbackUrl = await storageProvider.getPlaybackUrl(render.audioAsset.storagePath);
    result.set(render.lineIndex, {
      status: "COMPLETED",
      playbackUrl,
      durationMs: render.audioAsset.durationMs,
    });
  }
  return result;
}
