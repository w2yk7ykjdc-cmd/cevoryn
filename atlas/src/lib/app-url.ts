import "server-only";

function normalizeHttpUrl(value: string | undefined): string | null {
  if (!value) return null;

  try {
    const url = new URL(value.startsWith("http") ? value : `https://${value}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function getAppUrl(): string {
  return (
    normalizeHttpUrl(process.env.NEXT_PUBLIC_APP_URL) ??
    normalizeHttpUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL) ??
    normalizeHttpUrl(process.env.VERCEL_URL) ??
    "https://cevoryn.com"
  );
}
