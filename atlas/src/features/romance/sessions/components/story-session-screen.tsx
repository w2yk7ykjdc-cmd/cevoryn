"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import { submitStoryActionAction } from "../actions/submit-action";

import { RelationshipBars } from "./relationship-bars";

interface DialogueLine {
  speakerSlug: string;
  text: string;
}

interface AudioForLine {
  playbackUrl: string;
  durationMs: number;
}

interface SceneEntry {
  id: string;
  narration: string;
  dialogueLines: DialogueLine[];
  /** Keyed by dialogueLines index (as a string, since it crosses a JSON/props boundary). Absent entirely for a scene the player just submitted - audio renders out-of-band and only appears on a later load. */
  audioByLine?: Record<string, AudioForLine>;
}

interface RelationshipDimensions {
  trust: number;
  attraction: number;
  fear: number;
  loyalty: number;
  tension: number;
}

interface StorySessionScreenProps {
  storySessionId: string;
  beatName: string;
  characterNames: Record<string, string>;
  availableCharacterSlugs: string[];
  initialScenes: SceneEntry[];
  initialRelationships: Record<string, RelationshipDimensions>;
  initialSessionCompleted: boolean;
}

function friendlyRejectionMessage(reason: string): string {
  if (reason.startsWith("unparseable:")) {
    return "The words don't quite reach the room - try saying it plainly.";
  }
  switch (reason) {
    case "not_allowed_in_current_beat":
      return "That isn't something you can do here, not yet.";
    case "bargain_requires_breach_consequence":
      return "A bargain needs its cost named before it can be spoken.";
    case "missing_target_character":
      return "Who are you speaking to?";
    case "no_proposed_bargain_to_accept":
      return "There is no bargain on the table to accept.";
    case "no_sealed_bargain_to_break":
      return "There is no sealed bargain here to break.";
    case "bargain_state_changed_concurrently":
      return "Something shifted just as you spoke - try again.";
    default:
      return "That didn't quite land. Try again.";
  }
}

export function StorySessionScreen({
  storySessionId,
  beatName,
  characterNames,
  availableCharacterSlugs,
  initialScenes,
  initialRelationships,
  initialSessionCompleted,
}: StorySessionScreenProps) {
  const [scenes, setScenes] = useState<SceneEntry[]>(initialScenes);
  const [relationships, setRelationships] =
    useState<Record<string, RelationshipDimensions>>(initialRelationships);
  const [targetCharacterSlug, setTargetCharacterSlug] = useState(
    availableCharacterSlugs[0] ?? ""
  );
  const [rawInput, setRawInput] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [sessionCompleted, setSessionCompleted] = useState(initialSessionCompleted);
  const [currentBeatName, setCurrentBeatName] = useState(beatName);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!rawInput.trim() || isPending || sessionCompleted) return;

    setIsPending(true);
    try {
      const result = await submitStoryActionAction({
        storySessionId,
        rawInput,
        targetCharacterSlug: targetCharacterSlug || undefined,
        idempotencyKey: crypto.randomUUID(),
      });

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      const inner = result.data;
      if (!inner.accepted) {
        toast(friendlyRejectionMessage(inner.reason));
        return;
      }

      setScenes((prev) => [
        ...prev,
        {
          id: inner.storyEventId,
          narration: inner.scene.narration,
          dialogueLines: inner.scene.dialogueLines,
        },
      ]);
      setRawInput("");

      if (inner.relationshipChanges && targetCharacterSlug) {
        setRelationships((prev) => {
          const current = prev[targetCharacterSlug] ?? {
            trust: 0,
            attraction: 0,
            fear: 0,
            loyalty: 0,
            tension: 0,
          };
          const next = { ...current };
          for (const change of inner.relationshipChanges ?? []) {
            next[change.dimension] = change.newValue;
          }
          return { ...prev, [targetCharacterSlug]: next };
        });
      }

      if (inner.beatAdvancedTo) {
        setCurrentBeatName(inner.beatAdvancedTo);
        toast("The story moves forward.");
      }

      if (inner.sessionCompleted) {
        setSessionCompleted(true);
        toast("This chapter of the story has reached its end.");
      }
    } catch {
      toast.error("Something interrupted the story. Please try again.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-xl text-[#f1e9f4]">{currentBeatName}</h1>
      </div>

      {targetCharacterSlug && relationships[targetCharacterSlug] && (
        <RelationshipBars
          characterName={characterNames[targetCharacterSlug] ?? targetCharacterSlug}
          dimensions={relationships[targetCharacterSlug]}
        />
      )}

      <div
        className="space-y-4 rounded-lg border border-white/10 bg-[#140b1b]/60 p-4"
        aria-live="polite"
      >
        {scenes.length === 0 && (
          <p className="text-sm text-[#a08bb0]">The story is about to begin.</p>
        )}
        {scenes.map((scene) => (
          <div key={scene.id} className="space-y-2">
            <p className="text-sm leading-relaxed text-[#e4d9ea]">{scene.narration}</p>
            {scene.dialogueLines.map((line, index) => {
              const audio = scene.audioByLine?.[index];
              return (
                <div key={index} className="space-y-1">
                  <p className="text-sm italic text-[#c9a7e0]">
                    <span className="font-medium not-italic">
                      {characterNames[line.speakerSlug] ?? line.speakerSlug}:
                    </span>{" "}
                    &ldquo;{line.text}&rdquo;
                  </p>
                  {audio && (
                    <audio controls preload="none" src={audio.playbackUrl} className="h-8 w-full max-w-xs">
                      Your browser does not support audio playback.
                    </audio>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {isPending && (
          <p className="flex items-center gap-2 text-sm text-[#a08bb0]" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            The story is unfolding...
          </p>
        )}
      </div>

      {sessionCompleted ? (
        <p className="rounded-lg border border-white/10 bg-[#1c1024]/70 p-4 text-sm text-[#c9b8d4]">
          This chapter has ended. Thank you for playing.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          {availableCharacterSlugs.length > 1 && (
            <div className="flex items-center gap-2 text-sm text-[#c9b8d4]">
              <label htmlFor="target-character">Speaking to</label>
              <select
                id="target-character"
                value={targetCharacterSlug}
                onChange={(event) => setTargetCharacterSlug(event.target.value)}
                className="rounded-md border border-white/20 bg-[#120a18] px-2 py-1 text-[#f1e9f4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c9a7e0]"
              >
                {availableCharacterSlugs.map((slug) => (
                  <option key={slug} value={slug}>
                    {characterNames[slug] ?? slug}
                  </option>
                ))}
              </select>
            </div>
          )}

          <Textarea
            value={rawInput}
            onChange={(event) => setRawInput(event.target.value)}
            placeholder="I step closer but don't touch him."
            rows={3}
            maxLength={2000}
            disabled={isPending}
            aria-label="What do you do or say?"
            className="border-white/20 bg-[#120a18] text-[#f1e9f4] placeholder:text-[#6b5a78]"
          />

          <Button
            type="submit"
            disabled={isPending || !rawInput.trim()}
            className="w-full bg-[#5c3a73] text-white hover:bg-[#6d4788] sm:w-auto"
          >
            {isPending && <Loader2 className="animate-spin" />}
            Continue
          </Button>
        </form>
      )}
    </div>
  );
}
