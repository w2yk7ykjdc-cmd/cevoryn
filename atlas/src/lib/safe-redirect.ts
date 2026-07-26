import { ROUTES } from "@/lib/constants";

/**
 * Accept only same-origin application paths.
 * Reject protocol-relative URLs, backslashes, control characters and malformed input.
 */
export function getSafeRedirectPath(
  value: string | null | undefined,
  fallback: string = ROUTES.DASHBOARD
): string {
  if (!value) return fallback;

  const path = value.trim();
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\") ||
    /[\u0000-\u001F\u007F]/.test(path)
  ) {
    return fallback;
  }

  try {
    const parsed = new URL(path, "https://cevoryn.local");
    if (parsed.origin !== "https://cevoryn.local") return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
