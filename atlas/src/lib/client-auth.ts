"use client";

/** Redirect the browser to login while preserving the current route. */
export function redirectToLogin(): void {
  const next = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
}

/** Handle an expired session consistently for client-side API calls. */
export function handleUnauthorized(response: Response): boolean {
  if (response.status !== 401) return false;
  redirectToLogin();
  return true;
}
