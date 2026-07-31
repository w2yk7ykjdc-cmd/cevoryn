import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { getCanonicalOrigin } from "@/lib/canonical-origin";

// Projects publish continuously and crawlers expect fresh state, so this
// is computed per-request rather than frozen at build time. A single
// indexed query returning a few thousand published-page rows is well
// within what this needs to stay fast at that scale.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const projects = await prisma.project.findMany({
    where: { published: true },
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
