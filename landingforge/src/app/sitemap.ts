import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";

// Projects publish continuously, so this must be computed per-request (or
// on a short revalidation) rather than frozen once at build time.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  const projects = await prisma.project.findMany({
    where: { published: true },
    select: {
      slug: true,
      pages: {
        where: { status: "PUBLISHED" },
        select: { slug: true, updatedAt: true },
      },
    },
  });

  return projects.flatMap((project) =>
    project.pages.map((page) => ({
      url: `${appUrl}/${project.slug}${page.slug === "/" ? "" : page.slug}`,
      lastModified: page.updatedAt,
    })),
  );
}
