/**
 * Beat Graph auto-advance - pure. See Story Engine Bible §7: each Beat
 * declares exitConditions as a small rule list (the shape persisted in
 * Beat.exitConditions Json, authored in prisma/seed-romance.ts), and the
 * Story Engine checks them after every resolved action - never a
 * hand-authored branch tree per playthrough.
 */

export interface BeatExitRule {
  onEventType: string;
  next: string | null;
  minOccurrencesInBeat?: number;
  completesSession?: boolean;
}

export interface BeatTransitionResult {
  next: string | null;
  completesSession: boolean;
}

/**
 * Maps the intent that was just resolved to the event type a beat's
 * exitConditions key off. Kept separate from what is actually persisted
 * to StoryEvent.type (which stays INTENT_RESOLVED/INTENT_REJECTED for
 * every accepted/rejected action - see romance-story.service.ts) so this
 * richer vocabulary (BARGAIN_SEALED/BARGAIN_BROKEN) can drive beat
 * transitions without changing the audit trail's existing shape.
 */
export function deriveBeatTransitionEventType(intentType: string): string {
  if (intentType === "ACCEPT_BARGAIN") return "BARGAIN_SEALED";
  if (intentType === "BREAK_BARGAIN") return "BARGAIN_BROKEN";
  return "INTENT_RESOLVED";
}

/**
 * Checks exit rules for the first match on `effectiveEventType` whose
 * minimum-occurrence threshold is already met. `occurrencesInBeat` must
 * include the action that just happened (i.e. counted *after* recording
 * it). Rules are checked in declaration order; the first match wins.
 */
export function evaluateBeatTransition(
  exitRules: BeatExitRule[],
  effectiveEventType: string,
  occurrencesInBeat: number
): BeatTransitionResult | null {
  for (const rule of exitRules) {
    if (rule.onEventType !== effectiveEventType) continue;
    const min = rule.minOccurrencesInBeat ?? 1;
    if (occurrencesInBeat >= min) {
      return { next: rule.next, completesSession: rule.completesSession ?? false };
    }
  }
  return null;
}
