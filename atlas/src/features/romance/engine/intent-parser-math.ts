/**
 * Deterministic free-form Intent Parser. Pure - no server-only, no
 * Prisma, no AI call - per docs/romance/00-REPOSITORY_AUDIT.md's "split
 * pure logic from server-only orchestration" convention and
 * docs/romance/02-STORY_ENGINE_BIBLE.md §8.
 *
 * MVP scope is a deterministic, pattern-based parser covering the beat
 * graph's actual action vocabulary (PROMISE / REVEAL_TRUE_NAME /
 * PROPOSE_BARGAIN / ACCEPT_BARGAIN / BREAK_BARGAIN / ASK_QUESTION), with a
 * GENERIC_ACTION fallback for anything else and an UNPARSEABLE result for
 * input that must never be forwarded to scene generation unexamined
 * (brief §8: "never just 'continue the story' sent straight to the LLM").
 * An LLM-assisted parser upgrade (for richer free text) is explicitly
 * post-MVP - see Product Bible's post-MVP boundary.
 */

import type { StructuredIntent, StructuredIntentType } from "./types";

const MAX_INPUT_LENGTH = 2000;

const PROMISE_PATTERNS = [
  /\bi promise\b/i,
  /\bi swear\b/i,
  /\byou have my word\b/i,
];

const REVEAL_NAME_PATTERNS = [
  /\bmy (?:true )?name is ([a-z][a-z' -]{1,40})/i,
  /\bi am called ([a-z][a-z' -]{1,40})/i,
];

const PROPOSE_BARGAIN_PATTERNS = [
  /\bi propose a bargain\b/i,
  /\bi offer you a bargain\b/i,
  /\blet'?s make a bargain\b/i,
  /\bi offer you a deal\b/i,
];

const ACCEPT_BARGAIN_PATTERNS = [
  /\bi accept (?:the|your) bargain\b/i,
  /\bi agree to (?:the|your) terms\b/i,
  /\bi accept (?:the|your) deal\b/i,
];

const BREAK_BARGAIN_PATTERNS = [
  /\bi (?:won'?t|will not) honor\b/i,
  /\bi refuse to keep my (?:promise|bargain|word)\b/i,
  /\bi break (?:the|our|my) bargain\b/i,
];

const QUESTION_PATTERNS = [/\?\s*$/, /^\s*(who|what|why|where|when|how)\b/i];

/**
 * Heuristic-only prompt-injection detector. This is defense-in-depth, not
 * the safety boundary itself - the real boundary is that free text is
 * NEVER interpolated into a system/instruction role and NEVER treated as
 * anything but story-world dialogue content (brief §17/§16). A flagged
 * intent still proceeds through normal validation; the flag is for
 * logging/monitoring and stricter downstream scrutiny, never a silent
 * bypass.
 */
const PROMPT_INJECTION_PATTERNS = [
  /\bignore (?:all |the )?(?:previous|above|prior) instructions\b/i,
  /\byou are now\b/i,
  /\bsystem\s*:/i,
  /\bnew instructions\s*:/i,
  /\bact as (?:an?|the) (?:dan|jailbreak|unfiltered)/i,
  /\breveal your (?:system )?prompt\b/i,
];

function hasControlCharacters(raw: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(raw);
}

function detectFlags(normalized: string): StructuredIntent["flags"] {
  return {
    possiblePromptInjection: PROMPT_INJECTION_PATTERNS.some((p) =>
      p.test(normalized)
    ),
  };
}

function matchesAny(patterns: RegExp[], text: string): boolean {
  return patterns.some((p) => p.test(text));
}

/**
 * Parses one piece of raw player input into a StructuredIntent. Never
 * throws - malformed input (empty, too long, control characters) resolves
 * to an UNPARSEABLE intent the caller must handle explicitly (clarify or
 * reject), rather than being silently passed through.
 */
export function parseFreeformIntent(rawInput: string): StructuredIntent {
  if (typeof rawInput !== "string" || rawInput.trim().length === 0) {
    return {
      type: "UNPARSEABLE",
      content: "",
      unparseableReason: "empty",
      flags: { possiblePromptInjection: false },
    };
  }

  if (hasControlCharacters(rawInput)) {
    return {
      type: "UNPARSEABLE",
      content: "",
      unparseableReason: "control_characters",
      flags: { possiblePromptInjection: false },
    };
  }

  if (rawInput.length > MAX_INPUT_LENGTH) {
    return {
      type: "UNPARSEABLE",
      content: "",
      unparseableReason: "too_long",
      flags: { possiblePromptInjection: false },
    };
  }

  const normalized = rawInput.trim().replace(/\s+/g, " ");
  const flags = detectFlags(normalized);

  const nameMatch = REVEAL_NAME_PATTERNS.map((p) =>
    normalized.match(p)
  ).find((m) => m !== null);
  if (nameMatch) {
    return {
      type: "REVEAL_TRUE_NAME",
      content: normalized,
      revealedName: (nameMatch[1] ?? "").trim(),
      flags,
    };
  }

  const type: StructuredIntentType | null = matchesAny(
    PROMISE_PATTERNS,
    normalized
  )
    ? "PROMISE"
    : matchesAny(PROPOSE_BARGAIN_PATTERNS, normalized)
      ? "PROPOSE_BARGAIN"
      : matchesAny(ACCEPT_BARGAIN_PATTERNS, normalized)
        ? "ACCEPT_BARGAIN"
        : matchesAny(BREAK_BARGAIN_PATTERNS, normalized)
          ? "BREAK_BARGAIN"
          : matchesAny(QUESTION_PATTERNS, normalized)
            ? "ASK_QUESTION"
            : null;

  return {
    type: type ?? "GENERIC_ACTION",
    content: normalized,
    flags,
  };
}
