/**
 * Pure, I/O-free URL-safety check for user-supplied adapter URLs (e.g.
 * ExternalEntity.metadata.rssUrl) - no "server-only" so it stays
 * importable from plain Node test files, mirroring this codebase's other
 * pure-validation modules.
 *
 * This is a first-layer SSRF mitigation, not a complete one: it rejects
 * non-http(s) schemes and literal private/loopback/link-local/reserved IP
 * hostnames (including the 169.254.169.254 cloud-metadata address) at the
 * string level. It does NOT resolve DNS, so a hostname that only resolves
 * to a private IP at connect time (DNS rebinding) is not caught here -
 * that residual risk is why fetch-with-retry.ts additionally passes
 * `redirect: "error"` on every request, which closes the more common
 * redirect-to-internal-URL bypass. A fuller fix (resolve-then-connect-by-
 * IP) would need a custom fetch agent and is not implemented.
 */

const PRIVATE_IPV4_PATTERNS: RegExp[] = [
  /^127\./, // loopback
  /^10\./, // private
  /^172\.(1[6-9]|2\d|3[0-1])\./, // private
  /^192\.168\./, // private
  /^169\.254\./, // link-local, includes cloud metadata (169.254.169.254)
  /^0\./, // "this network"
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // carrier-grade NAT (100.64.0.0/10)
];

function isPrivateIPv4(hostname: string): boolean {
  return PRIVATE_IPV4_PATTERNS.some((pattern) => pattern.test(hostname));
}

function isPrivateIPv6(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    normalized === "::1" || // loopback
    normalized.startsWith("fc") || // unique local fc00::/7
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80") // link-local
  );
}

export function isSafePublicUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return false;

  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return false;
  }
  if (hostname.includes(":")) {
    // IPv6 literal (URL hostname keeps the brackets for IPv6).
    return !isPrivateIPv6(hostname);
  }
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    return !isPrivateIPv4(hostname);
  }

  return true;
}
