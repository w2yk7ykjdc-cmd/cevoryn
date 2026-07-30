import { cache } from "react";
import { prisma } from "@/lib/prisma";

function normalizeSlug(path: string[] | undefined) {
  return path && path.length > 0 ? `/${path.join("/")}` : "/";
}

export const getPublicPage = cache(
  async (projectSlug: string, path: string[] | undefined, locale?: string) => {
    const project = await prisma.project.findFirst({
      where: { slug: projectSlug, published: true },
      include: { theme: true },
    });
    if (!project) return null;

    const slug = normalizeSlug(path);
    const resolvedLocale = locale || project.primaryLocale;

    const page = await prisma.page.findFirst({
      where: { projectId: project.id, slug, status: "PUBLISHED" },
      include: {
        sections: {
          orderBy: { order: "asc" },
          include: { contents: { where: { locale: resolvedLocale } } },
        },
        seoMeta: { where: { locale: resolvedLocale } },
      },
    });
    if (!page) return null;

    return { project, page, locale: resolvedLocale };
  },
);
