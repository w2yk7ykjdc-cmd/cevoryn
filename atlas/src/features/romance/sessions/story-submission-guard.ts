/**
 * Pure guard for whether a story-action submission may proceed. Pulled out
 * of story-session-screen.tsx so the duplicate-submission rule (the actual
 * business logic, not the React wiring around it) is directly unit-testable
 * without a DOM/React test harness - no "server-only", no Prisma.
 */
export interface SubmissionGuardState {
  rawInput: string;
  isPending: boolean;
  sessionCompleted: boolean;
  /** A synchronous (ref-backed) in-flight flag - catches a second submit
   * fired before React commits the `isPending` state update, which a
   * double-tap/double-click can do. */
  isSubmitting: boolean;
}

export function canSubmitStoryAction(state: SubmissionGuardState): boolean {
  return (
    state.rawInput.trim().length > 0 &&
    !state.isPending &&
    !state.sessionCompleted &&
    !state.isSubmitting
  );
}
