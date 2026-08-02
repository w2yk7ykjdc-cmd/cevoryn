import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getAppHost, getCanonicalOrigin } from "@/lib/canonical-origin";

// Projects publish continuously and crawlers expect fresh state, so this
// is computed per-request rather than frozen at build time. A single
// indexed query returning a few thousand published-page rows is well
// within what this needs to stay fast at that scale.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const host = (await headers()).get("host")?.split(":")[0];
  const appHost = getAppHost();
  // Reached via a custom domain (proxy.ts leaves /sitemap.xml unrewritten
  // for these) - scope the sitemap to that one project instead of listing
  // every published project on the platform.
  const isCustomDomain = Boolean(host && host !== appHost);

  const projects = await prisma.project.findMany({
    where: {
      published: true,
      ...(isCustomDomain
        ? { customDomain: host, customDomainStatus: "VERIFIED" }
        : {}),
    },
    select: {
      slug: true,
      customDomain: true,
      customDomainStatus: true,
      pages: {
        where: { status: "PUBLISHED" },
        select: { slug: true, updatedAt: true },
      },
    },
  });

  return projects.flatMap((project) => {
    const origin = getCanonicalOrigin(project);
    return project.pages.map((page) => ({
      url: `${origin}${page.slug === "/" ? "" : page.slug}`,
      lastModified: page.updatedAt,
    }));
  });
}
