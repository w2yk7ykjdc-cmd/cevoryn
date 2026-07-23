"use client";

const PENDING_CHAT_PREFIX = "atlas:pending-chat:";

/** Redirect the browser to login while preserving the current route. */
export function redirectToLogin(): void {
  const next = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
}

/** Save an unsent chat message so it is not lost during re-authentication. */
export function preservePendingChatMessage(
  conversationId: string,
  content: string
): void {
  try {
    window.sessionStorage.setItem(
      `${PENDING_CHAT_PREFIX}${conversationId}`,
      content
    );
  } catch {
    // Storage can be unavailable in restricted browser modes.
  }
}

/** Read and clear a chat message preserved during re-authentication. */
export function consumePendingChatMessage(
  conversationId: string
): string | null {
  try {
    const key = `${PENDING_CHAT_PREFIX}${conversationId}`;
    const content = window.sessionStorage.getItem(key);
    if (content) window.sessionStorage.removeItem(key);
    return content;
  } catch {
    return null;
  }
}

/** Handle an expired session consistently for client-side API calls. */
export function handleUnauthorized(response: Response): boolean {
  if (response.status !== 401) return false;
  redirectToLogin();
  return true;
}
