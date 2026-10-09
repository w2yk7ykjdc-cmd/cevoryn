"use client";

import {
  Loader2,
  Lock,
  MessageCircle,
  ShieldAlert,
  HeartHandshake,
  Search,
  UserRound,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import { submitStoryActionAction } from "../actions/submit-action";
import { canSubmitStoryAction } from "../story-submission-guard";

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
  /** Keyed by dialogueLines index. Audio is optional and only rendered when a real asset exists. */
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
  isPremium: boolean;
}

const QUICK_ACTIONS = [
  {
    label: "Ask for details",
    description: "Find out more about the hidden group.",
    prompt:
      "I ask him what he knows about the group and where we should begin looking.",
    Icon: Search,
  },
  {
    label: "Show trust",
    description: "Let him know you are listening.",
    prompt:
      "I meet his gaze and tell him I want to trust him, but I need the truth.",
    Icon: HeartHandshake,
  },
  {
    label: "Be cautious",
    description: "Keep your guard up.",
    prompt: "I keep a little distance and ask what he is not telling me.",
    Icon: ShieldAlert,
  },
] as const;

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
  isPremium,
}: StorySessionScreenProps) {
  const [scenes, setScenes] = useState<SceneEntry[]>(initialScenes);
  const [relationships, setRelationships] =
    useState<Record<string, RelationshipDimensions>>(initialRelationships);
  const [targetCharacterSlug, setTargetCharacterSlug] = useState(
    availableCharacterSlugs[0] ?? ""
  );
  const [rawInput, setRawInput] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [sessionCompleted, setSessionCompleted] = useState(
    initialSessionCompleted
  );
  const [currentBeatName, setCurrentBeatName] = useState(beatName);

  // Guards against a double-tap/double-click firing two submissions before
  // React commits the isPending state update that disables the button -
  // the `isPending` state check alone isn't synchronous enough to catch that.
  const isSubmittingRef = useRef(false);
  const latestSceneRef = useRef<HTMLDivElement | null>(null);
  const hasMountedRef = useRef(false);

  useEffect(() => {
    if (!hasMountedRef.current) {
      // Don't auto-scroll on first load of a resumed session's history.
      hasMountedRef.current = true;
      return;
    }
    latestSceneRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, [scenes.length]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (
      !canSubmitStoryAction({
        rawInput,
        isPending,
        sessionCompleted,
        isSubmitting: isSubmittingRef.current,
      })
    ) {
      return;
    }

    isSubmittingRef.current = true;
    setIsPending(true);
    try {
      const result = await submitStoryActionAction({
        storySessionId,
        rawInput: rawInput.trim(),
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
        setCurrentBeatName(inner.beatAdvancedToName ?? inner.beatAdvancedTo);
        toast("The story moves forward.");
      }

      if (inner.sessionCompleted) {
        setSessionCompleted(true);
        toast("This chapter of the story has reached its end.");
      }
    } catch {
      toast.error("Something interrupted the story. Please try again.");
    } finally {
      isSubmittingRef.current = false;
      setIsPending(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 text-[#332532]">
      <header className="rounded-2xl border border-[#eadde5] bg-gradient-to-br from-white via-[#fffaf8] to-[#f8edf2] p-5 shadow-sm sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#a34e79]">
          Thornbound · Story in progress
        </p>
        <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight text-[#44253f] sm:text-4xl">
          {currentBeatName}
        </h1>
        <div className="mt-3 h-1 w-16 rounded-full bg-gradient-to-r from-[#b75b88] to-[#ead0dd]" />
      </header>

      {availableCharacterSlugs.length > 0 && (
        <section
          aria-labelledby="character-selection-title"
          className="space-y-3"
        >
          {availableCharacterSlugs.length > 1 && (
            <>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <h2
                    id="character-selection-title"
                    className="font-serif text-xl font-semibold text-[#44253f]"
                  >
                    Who are you speaking to?
                  </h2>
                  <p className="mt-1 text-sm text-[#806d7d]">
                    Choose a character before you send your action.
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-[#f4e5ed] px-3 py-1 text-xs font-medium text-[#8f3f69]">
                  {availableCharacterSlugs.length} characters
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {availableCharacterSlugs.map((slug) => {
                  const selected = targetCharacterSlug === slug;
                  const name = characterNames[slug] ?? slug;
                  const relationship = relationships[slug];
                  return (
                    <button
                      key={slug}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setTargetCharacterSlug(slug)}
                      disabled={isPending}
                      className={[
                        "flex min-h-16 items-center gap-3 rounded-xl border p-3 text-left transition",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b75b88] focus-visible:ring-offset-2",
                        "disabled:cursor-not-allowed disabled:opacity-60",
                        selected
                          ? "border-[#b75b88] bg-[#f9edf3] shadow-sm"
                          : "border-[#eadde5] bg-white hover:border-[#d5a5bd] hover:bg-[#fff9fc]",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border font-serif text-lg font-semibold",
                          selected
                            ? "border-[#d7a3bc] bg-white text-[#913f6c]"
                            : "border-[#eadde5] bg-[#fbf4f7] text-[#9b7b91]",
                        ].join(" ")}
                      >
                        {name.trim().charAt(0).toUpperCase() || (
                          <UserRound className="h-5 w-5" aria-hidden="true" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-[#44253f]">
                          {name}
                        </span>
                        <span className="mt-0.5 block text-xs text-[#806d7d]">
                          {relationship
                            ? "Relationship tracked"
                            : "Story character"}
                        </span>
                      </span>
                      <span
                        aria-hidden="true"
                        className={[
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs",
                          selected
                            ? "border-[#a34e79] bg-[#a34e79] text-white"
                            : "border-[#d9c8d3] text-transparent",
                        ].join(" ")}
                      >
                        ✓
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
          {targetCharacterSlug && relationships[targetCharacterSlug] && (
            <div className="rounded-xl border border-[#eadde5] bg-white p-4">
              <RelationshipBars
                characterName={
                  characterNames[targetCharacterSlug] ?? targetCharacterSlug
                }
                dimensions={relationships[targetCharacterSlug]}
              />
            </div>
          )}
        </section>
      )}

      <section
        className="space-y-4 rounded-2xl border border-[#eadde5] bg-white p-4 shadow-sm sm:space-y-5 sm:p-6"
        aria-label="Story dialogue"
        aria-live="polite"
      >
        {scenes.length === 0 && (
          <p className="rounded-xl bg-[#fbf4f7] p-4 text-sm text-[#806d7d]">
            The story is about to begin.
          </p>
        )}
        {!isPremium &&
          scenes.some((scene) => scene.dialogueLines.length > 0) && (
            <p className="flex items-start gap-2 rounded-xl border border-[#ead5e2] bg-[#fff7fb] px-3 py-2.5 text-xs leading-relaxed text-[#806078]">
              <Lock
                className="mt-0.5 h-4 w-4 shrink-0 text-[#a34e79]"
                aria-hidden="true"
              />
              <span>
                Voiced dialogue is a Premium feature. Unlock Premium Voices to
                hear this scene performed.
              </span>
            </p>
          )}
        {scenes.map((scene, sceneIndex) => (
          <article
            key={scene.id}
            ref={sceneIndex === scenes.length - 1 ? latestSceneRef : undefined}
            className={
              sceneIndex > 0
                ? "space-y-3 border-t border-[#f0e5eb] pt-5"
                : "space-y-3"
            }
          >
            {scene.narration && (
              <p className="rounded-xl border-l-2 border-[#d8a3bc] bg-[#fbf4f7] px-4 py-3 font-serif text-base italic leading-relaxed text-[#72576c]">
                {scene.narration}
              </p>
            )}
            {scene.dialogueLines.map((line, index) => {
              const audio = scene.audioByLine?.[index];
              const speakerName =
                characterNames[line.speakerSlug] ?? line.speakerSlug;
              return (
                <div
                  key={index}
                  className="flex gap-3 rounded-xl border border-[#eee2e9] bg-[#fffdfc] p-3 sm:p-4"
                >
                  <span
                    aria-hidden="true"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#e5c8d8] bg-[#f8eaf1] font-serif text-base font-semibold text-[#913f6c]"
                  >
                    {speakerName.charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1 space-y-2">
                    <p className="text-sm font-semibold text-[#913f6c]">
                      {speakerName}
                    </p>
                    <p className="font-serif text-base leading-relaxed text-[#332532] sm:text-lg">
                      &ldquo;{line.text}&rdquo;
                    </p>
                    {audio && (
                      <audio
                        controls
                        preload="none"
                        src={audio.playbackUrl}
                        className="h-9 w-full max-w-sm"
                        aria-label={`Play ${speakerName}'s dialogue`}
                      >
                        Your browser does not support audio playback.
                      </audio>
                    )}
                  </div>
                </div>
              );
            })}
          </article>
        ))}
        {isPending && (
          <p
            className="flex items-center gap-2 rounded-xl bg-[#fbf4f7] p-3 text-sm text-[#806d7d]"
            role="status"
          >
            <Loader2
              className="h-4 w-4 animate-spin text-[#a34e79]"
              aria-hidden="true"
            />
            The story is unfolding…
          </p>
        )}
      </section>

      {!sessionCompleted ? (
        <section className="space-y-3 rounded-2xl border border-[#eadde5] bg-white p-4 shadow-sm sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-serif text-xl font-semibold text-[#44253f]">
              Your next move
            </h2>
            <span className="text-xs text-[#927e8e]">
              {rawInput.length}/2000
            </span>
          </div>
          <form onSubmit={handleSubmit} className="space-y-3">
            <Textarea
              value={rawInput}
              onChange={(event) => setRawInput(event.target.value)}
              placeholder={
                targetCharacterSlug
                  ? `What do you want to say or do with ${characterNames[targetCharacterSlug] ?? targetCharacterSlug}?`
                  : "What do you do or say?"
              }
              rows={3}
              maxLength={2000}
              disabled={isPending}
              aria-label="What do you do or say?"
              className="min-h-28 resize-y rounded-xl border-[#e6d5df] bg-[#fffdfc] text-[#332532] placeholder:text-[#a18d9c] focus-visible:ring-[#b75b88]"
            />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs leading-relaxed text-[#927e8e]">
                Write freely. Suggested actions can help you get started.
              </p>
              <Button
                type="submit"
                disabled={isPending || !rawInput.trim() || !targetCharacterSlug}
                className="min-h-11 w-full rounded-xl bg-[#963f70] px-6 text-white hover:bg-[#7f315e] focus-visible:ring-[#b75b88] sm:w-auto"
              >
                {isPending ? (
                  <Loader2
                    className="mr-2 h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <MessageCircle className="mr-2 h-4 w-4" aria-hidden="true" />
                )}
                {isPending ? "Sending…" : "Send action"}
              </Button>
            </div>
          </form>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#927e8e]">
              Try a suggested action
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {QUICK_ACTIONS.map(({ label, description, prompt, Icon }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setRawInput(prompt)}
                  disabled={isPending}
                  className="flex min-h-16 items-center gap-3 rounded-xl border border-[#eadde5] bg-[#fffafc] p-3 text-left transition hover:border-[#d5a5bd] hover:bg-[#f9edf3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b75b88] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f5e3ec] text-[#963f70]">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-[#44253f]">
                      {label}
                    </span>
                    <span className="mt-0.5 block text-xs leading-snug text-[#806d7d]">
                      {description}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </section>
      ) : (
        <p className="rounded-2xl border border-[#eadde5] bg-white p-5 text-sm text-[#806d7d]">
          This chapter has ended. Thank you for playing.
        </p>
      )}
    </div>
  );
}
