// Single source of truth for "what host does the app itself run on" - used
// to tell a visitor's own custom domain apart from the platform's own
// domain wherever that distinction matters (proxy rewrite, sitemap/robots
// scoping).
export function getAppHost(): string | undefined {
  try {
    return new URL(process.env.NEXT_PUBLIC_APP_URL ?? "").host;
  } catch {
    return undefined;
  }
}

// Single source of truth for "what is this project's one true public
// origin" - used by both page metadata (canonical tag) and the sitemap, so
// the two can never disagree about which URL a project is indexed under.
export function getCanonicalOrigin(project: {
  slug: string;
  customDomain: string | null;
  customDomainStatus: string;
}): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  return project.customDomainStatus === "VERIFIED" && project.customDomain
    ? `https://${project.customDomain}`
    : `${appUrl}/${project.slug}`;
}
