/**
 * Shared sanitizers and validators for Google integration modules.
 */

/** Strip control characters, collapse whitespace, and truncate safely. */
export function cleanText(
  value: unknown,
  maxLength: number,
  preserveNewlines = false,
): string {
  if (typeof value !== "string") return "";

  const cleaned = preserveNewlines
    ? value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
    : value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();

  return cleaned.slice(0, maxLength);
}

/** Validate and deduplicate an array of email addresses. */
export function parseEmails(
  value: unknown,
  max: number,
  optional = false,
): string[] | null {
  if (value === undefined) return optional ? [] : null;
  if (!Array.isArray(value) || value.length > max) return null;

  const emails = value.map((item) =>
    typeof item === "string" ? item.trim().toLowerCase() : "",
  );

  return emails.every(isEmail) ? Array.from(new Set(emails)) : null;
}

function isEmail(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}
