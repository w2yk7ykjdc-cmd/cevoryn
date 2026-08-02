// Project slugs are served at /{slug} on the app's own domain, which the
// static app routes below already own - a project slug matching one of
// these would never be reachable (Next.js resolves the static route
// first), so it can never be assigned to a project.
export const RESERVED_SLUGS = new Set([
  "login",
  "dashboard",
  "pricing",
  "api",
  "auth",
  "error",
  "domain-view",
]);

const TURKISH_CHAR_MAP: Record<string, string> = {
  ç: "c",
  Ç: "c",
  ğ: "g",
  Ğ: "g",
  ı: "i",
  İ: "i",
  ö: "o",
  Ö: "o",
  ş: "s",
  Ş: "s",
  ü: "u",
  Ü: "u",
};

function transliterateTurkish(input: string) {
  return input.replace(/[çÇğĞıİöÖşŞüÜ]/g, (char) => TURKISH_CHAR_MAP[char] ?? char);
}

export function slugify(input: string) {
  return transliterateTurkish(input)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function truncateAtWordBoundary(input: string, maxLength: number) {
  const trimmed = input.trim();
  if (trimmed.length <= maxLength) return trimmed;
  const cut = trimmed.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
}
