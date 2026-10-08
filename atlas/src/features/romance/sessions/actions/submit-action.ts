"use server";

import { after } from "next/server";
import { z } from "zod";

import { captureServerError } from "@/lib/error-reporting";
import type { ActionResult } from "@/types";

import { renderSceneAudio } from "../../audio/audio-render.service";
import { recordRomanceAuditEvent } from "../../audit/romance-audit.service";
import { isRomancePremiumActive } from "../../billing/entitlement-math";
import { getRomanceSubscription } from "../../billing/romance-subscription.service";
import {
  RomanceStoryNotFoundError,
  submitPlayerInput,
} from "../../engine/romance-story.service";
import type { SubmitPlayerInputResult } from "../../engine/romance-story.service";
import { createRomanceNotification } from "../../notifications/romance-notification.service";
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

function displayNameForSlug(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

/**
 * Best-effort audit + in-app-notification writes for the real story facts
 * this one action already knows about (Product Bible §15: every
 * notification must cite a real, specific fact). Never awaited into the
 * player's response path's failure handling - a logging failure must
 * never turn an accepted story action into an error response.
 */
async function recordStoryFacts(
  playerId: string,
  targetCharacterSlug: string | undefined,
  result: SubmitPlayerInputResult
): Promise<void> {
  if (!result.accepted) return;

  const characterName = targetCharacterSlug ? displayNameForSlug(targetCharacterSlug) : null;

  switch (result.intent.type) {
    case "ACCEPT_BARGAIN":
      await recordRomanceAuditEvent({
        playerId,
        actorType: "PLAYER",
        action: "bargain.sealed",
        resourceType: "StoryEvent",
        resourceId: result.storyEventId,
        metadata: { targetCharacterSlug },
      });
      if (characterName) {
        await createRomanceNotification({
          playerId,
          title: "A bargain is sealed",
          body: `You and ${characterName} have sealed a bargain. Its terms are now binding.`,
          payload: { storyEventId: result.storyEventId, targetCharacterSlug },
        });
      }
      break;
    case "BREAK_BARGAIN":
      await recordRomanceAuditEvent({
        playerId,
        actorType: "PLAYER",
        action: "bargain.broken",
        resourceType: "StoryEvent",
        resourceId: result.storyEventId,
        metadata: { targetCharacterSlug },
      });
      if (characterName) {
        await createRomanceNotification({
          playerId,
          title: "A bargain is broken",
          body: `You broke your sealed bargain with ${characterName}. There will be a price.`,
          payload: { storyEventId: result.storyEventId, targetCharacterSlug },
        });
      }
      break;
    case "PROMISE":
      await recordRomanceAuditEvent({
        playerId,
        actorType: "PLAYER",
        action: "promise.made",
        resourceType: "StoryEvent",
        resourceId: result.storyEventId,
        metadata: { targetCharacterSlug },
      });
      break;
    default:
      break;
  }

  if (result.beatAdvancedTo) {
    await recordRomanceAuditEvent({
      playerId,
      actorType: "SYSTEM",
      action: "beat.advanced",
      resourceType: "StoryEvent",
      resourceId: result.storyEventId,
      metadata: { beatSlug: result.beatAdvancedTo },
    });
    await createRomanceNotification({
      playerId,
      title: "The story moves forward",
      body: result.beatAdvancedToName
        ? `A new chapter begins: ${result.beatAdvancedToName}.`
        : "A new chapter has begun.",
      payload: { storyEventId: result.storyEventId, beatSlug: result.beatAdvancedTo },
    });
  }

  if (result.sessionCompleted) {
    await createRomanceNotification({
      playerId,
      title: "A chapter has ended",
      body: "This chapter of your story has reached its end.",
      payload: { storyEventId: result.storyEventId },
    });
  }
}

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
    //
    // "Premium voice performance" (Product Bible) is the paid feature -
    // a FREE player's scene is never sent to TTS at all, not even to
    // silently discard the result. Checked here (not inside
    // renderSceneAudio itself) so a FREE player's audio never costs a
    // TTS API call in the first place.
    if (result.accepted && result.scene.dialogueLines.length > 0) {
      const subscription = await getRomanceSubscription(player.id);
      if (isRomancePremiumActive(subscription)) {
        const { storyEventId, universeId, scene } = result;
        after(() =>
          renderSceneAudio({
            storyEventId,
            universeId,
            dialogueLines: scene.dialogueLines,
          }).catch((error) => {
            captureServerError("romance-audio-schedule", error, { storyEventId });
          })
        );
      }
    }

    // Best-effort audit/notification writes for this turn's real story
    // facts - never allowed to turn an otherwise-successful action into
    // an error response for the player.
    try {
      await recordStoryFacts(player.id, parsed.data.targetCharacterSlug, result);
    } catch (error) {
      captureServerError("romance-story-facts", error, { playerId: player.id });
    }

    return { success: true, data: result };
  } catch (error) {
    if (error instanceof RomanceStoryNotFoundError) {
      return { success: false, error: "That story session could not be found." };
    }
    captureServerError("romance-submit-story-action", error, { playerId: player.id });
    return {
      success: false,
      error: "Something interrupted the story. Please try again.",
    };
  }
}
