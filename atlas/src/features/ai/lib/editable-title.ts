export type TitleSubmission =
  { shouldSubmit: true; nextTitle: string } | { shouldSubmit: false };

/**
 * Shared by chat-header.tsx and chat-sidebar.tsx's inline rename UI. An
 * empty (post-trim) or unchanged draft is treated as "cancel", not an error
 * — the caller resets its draft state and closes the editor without calling
 * the rename action.
 */
export function resolveTitleSubmission(
  draftTitle: string,
  currentTitle: string
): TitleSubmission {
  const nextTitle = draftTitle.trim();
  if (!nextTitle || nextTitle === currentTitle) {
    return { shouldSubmit: false };
  }

  return { shouldSubmit: true, nextTitle };
}
