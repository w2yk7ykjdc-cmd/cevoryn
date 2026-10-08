"use server";

import { after } from "next/server";
import { z } from "zod";

import type { ActionResult } from "@/types";

import { renderSceneAudio } from "../../audio/audio-render.service";
import {
  RomanceStoryNotFoundError,
  submitPlayerInput,
} from "../../engine/romance-story.service";
import type { SubmitPlayerInputResult } from "../../engine/romance-story.service";
import {
  getAdultRomancePlayerOrThrow,
  RomanceAgeNotVerifiedError,
  RomanceNotAuthenticatedError,
} from "../../player/romance-player-guards";
import { isStoryActionRateLimited } from "../romance-rate-limit.service";

const submitStoryActionSchema = z.object({
  storySessionId: z.string().trim().min(1),
  rawInput: z.string().min(1).max(2000),
  targetCharacterSlug: z.string().trim().min(1).max(60).optional(),
  bargainBreachConsequence: z.string().trim().min(1).max(500).optional(),
  /** Client-generated - a retried call with the same key replays the original result instead of reprocessing. */
  idempotencyKey: z.string().trim().min(1).max(100).optional(),
});

export type SubmitStoryActionInput = z.infer<typeof submitStoryActionSchema>;

/**
 * The free-form input entry point. Re-checks authentication AND the 18+
 * gate server-side on every call (never trusts that the UI already
 * checked) - this is what makes the age gate real for a direct/crafted
 * call, not just a page redirect. Ownership of the session is enforced
 * inside submitPlayerInput's own tenant-scoped loader, so a crafted call
 * with someone else's storySessionId gets the same "not found" response
 * as a nonexistent one.
 */
export async function submitStoryActionAction(
  input: SubmitStoryActionInput
): Promise<ActionResult<SubmitPlayerInputResult>> {
  let player: { id: string };
  try {
    ({ player } = await getAdultRomancePlayerOrThrow());
  } catch (error) {
    if (error instanceof RomanceNotAuthenticatedError) {
      return { success: false, error: "Please sign in to continue." };
    }
    if (error instanceof RomanceAgeNotVerifiedError) {
      return { success: false, error: "18+ age verification is required." };
    }
    throw error;
  }

  const parsed = submitStoryActionSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "That input could not be understood." };
  }

  if (await isStoryActionRateLimited(player.id)) {
    return {
      success: false,
      error: "You're moving faster than the story can keep up with - take a breath and try again in a moment.",
    };
  }

  try {
    const result = await submitPlayerInput({
      playerId: player.id,
      storySessionId: parsed.data.storySessionId,
      rawInput: parsed.data.rawInput,
      targetCharacterSlug: parsed.data.targetCharacterSlug,
      bargainBreachConsequence: parsed.data.bargainBreachConsequence,
      idempotencyKey: parsed.data.idempotencyKey,
    });

    // Brief §20: audio rendering never runs inside the request/transaction
    // that commits story state - after() schedules it once the response
    // has been sent, so a slow or failed TTS/storage call can never delay
    // or lose the player's turn. Safe to re-schedule on an idempotency
    // replay too: renderSceneAudio() is itself idempotent per line.
    if (result.accepted && result.scene.dialogueLines.length > 0) {
      const { storyEventId, universeId, scene } = result;
      after(() =>
        renderSceneAudio({
          storyEventId,
          universeId,
          dialogueLines: scene.dialogueLines,
        }).catch((error) => {
          console.error(
            "[romance] renderSceneAudio scheduling failed",
            error instanceof Error ? error.message : "unknown error"
          );
        })
      );
    }

    return { success: true, data: result };
  } catch (error) {
    if (error instanceof RomanceStoryNotFoundError) {
      return { success: false, error: "That story session could not be found." };
    }
    console.error(
      "[romance] submitStoryActionAction failed",
      error instanceof Error ? error.message : "unknown error"
    );
    return {
      success: false,
      error: "Something interrupted the story. Please try again.",
    };
  }
}
