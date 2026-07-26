"use client";

import { ROUTES } from "@/lib/constants";
import { getSafeRedirectPath } from "@/lib/safe-redirect";

const PENDING_CHAT_PREFIX = "cevoryn:pending-chat:";
const LEGACY_PENDING_CHAT_PREFIX = "atlas:pending-chat:";

function getPendingChatKey(prefix: string, conversationId: string): string {
  return `${prefix}${conversationId}`;
}

/** Redirect the browser to login while preserving the current safe application route. */
export function redirectToLogin(): void {
  const currentPath = `${window.location.pathname}${window.location.search}`;
  const next = getSafeRedirectPath(currentPath, ROUTES.DASHBOARD);
  const loginUrl = new URL(ROUTES.LOGIN, window.location.origin);
  loginUrl.searchParams.set("next", next);
  loginUrl.searchParams.set("reason", "session_expired");
  window.location.assign(`${loginUrl.pathname}${loginUrl.search}`);
}

/** Save an unsent chat message so it is not lost during re-authentication. */
export function preservePendingChatMessage(
  conversationId: string,
  content: string
): void {
  try {
    window.sessionStorage.setItem(
      getPendingChatKey(PENDING_CHAT_PREFIX, conversationId),
      content
    );
    window.sessionStorage.removeItem(
      getPendingChatKey(LEGACY_PENDING_CHAT_PREFIX, conversationId)
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
    const key = getPendingChatKey(PENDING_CHAT_PREFIX, conversationId);
    const legacyKey = getPendingChatKey(
      LEGACY_PENDING_CHAT_PREFIX,
      conversationId
    );
    const content =
      window.sessionStorage.getItem(key) ??
      window.sessionStorage.getItem(legacyKey);

    window.sessionStorage.removeItem(key);
    window.sessionStorage.removeItem(legacyKey);
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
