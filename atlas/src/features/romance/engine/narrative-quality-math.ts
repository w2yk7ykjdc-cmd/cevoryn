/**
 * Narrative quality heuristics - pure, no Prisma, no AI. Distinct from
 * canon-validator-math (which checks hard FACTS a scene claims) - this
 * checks PROSE QUALITY: does the dialogue just restate the narration in
 * different words, does the scene actually say anything. Deliberately
 * NOT exact-string matching (trivially defeated by paraphrase) - uses
 * word-set (Jaccard) overlap, which catches "restated in slightly
 * different words" the way a human editor would flag it.
 *
 * Wired into scene-pipeline.service.ts as a second gate alongside
 * validateSceneClaims(): a scene can be canon-valid (makes no false
 * claims) and still be bad prose (restates itself, says nothing new) -
 * both are grounds for the same generate -> regenerate -> repair ->
 * fallback recovery, never for exposing broken-feeling prose to the
 * player.
 */

export interface NarrativeQualityIssue {
  code: "REPETITIVE_DIALOGUE" | "EMPTY_NARRATION";
  message: string;
}

const STOPWORDS = new Set([
  "that",
  "this",
  "with",
  "from",
  "have",
  "your",
  "there",
  "their",
  "about",
  "what",
  "when",
  "where",
  "which",
  "while",
  "would",
  "could",
  "should",
  "into",
  "onto",
  "over",
  "under",
  "been",
  "being",
  "were",
  "than",
  "then",
]);

function wordSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s']/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 3 && !STOPWORDS.has(word))
  );
}

/** Jaccard similarity: size of the intersection over the union, 0 (nothing shared) to 1 (identical word sets). */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Below this, a line is too short to meaningfully compare ("...", "Yes.", "No.") - never flagged as repetitive. */
const MIN_COMPARABLE_LENGTH = 15;
const REPETITION_THRESHOLD = 0.5;
const MIN_NARRATION_WORDS = 8;

export function evaluateNarrativeQuality(scene: {
  narration: string;
  dialogueLines: Array<{ speakerSlug: string; text: string }>;
}): NarrativeQualityIssue[] {
  const issues: NarrativeQualityIssue[] = [];

  const narrationWordCount = scene.narration
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  if (
    narrationWordCount < MIN_NARRATION_WORDS &&
    scene.dialogueLines.length === 0
  ) {
    issues.push({
      code: "EMPTY_NARRATION",
      message: `Narration is only ${narrationWordCount} word(s) with no dialogue - the scene makes no real progression (no new information, no complication, no relationship movement).`,
    });
  }

  const narrationWords = wordSet(scene.narration);
  for (const line of scene.dialogueLines) {
    if (line.text.trim().length < MIN_COMPARABLE_LENGTH) continue;
    const similarity = jaccardSimilarity(narrationWords, wordSet(line.text));
    if (similarity >= REPETITION_THRESHOLD) {
      issues.push({
        code: "REPETITIVE_DIALOGUE",
        message: `${line.speakerSlug}'s dialogue restates the narration in different words (${Math.round(similarity * 100)}% word overlap) instead of adding new information, subtext, or voice.`,
      });
    }
  }

  for (let i = 0; i < scene.dialogueLines.length; i++) {
    for (let j = i + 1; j < scene.dialogueLines.length; j++) {
      const a = scene.dialogueLines[i]!;
      const b = scene.dialogueLines[j]!;
      if (
        a.text.trim().length < MIN_COMPARABLE_LENGTH ||
        b.text.trim().length < MIN_COMPARABLE_LENGTH
      ) {
        continue;
      }
      const similarity = jaccardSimilarity(wordSet(a.text), wordSet(b.text));
      if (similarity >= REPETITION_THRESHOLD) {
        issues.push({
          code: "REPETITIVE_DIALOGUE",
          message: `${a.speakerSlug}'s and ${b.speakerSlug}'s lines repeat the same content (${Math.round(similarity * 100)}% word overlap) rather than each voicing something distinct.`,
        });
      }
    }
  }

  return issues;
}
