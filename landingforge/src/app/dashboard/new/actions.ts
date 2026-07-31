"use server";

import { redirect } from "next/navigation";
import { SectionType } from "@prisma/client";
import { requireUser } from "@/lib/get-current-user";
import { prisma } from "@/lib/prisma";
import { getThemePreset } from "@/lib/theme-presets";
import { generateAndSaveSectionContent } from "@/lib/generate-section-content";
import { slugify, truncateAtWordBoundary } from "@/lib/slugify";
import { UsageLimitExceededError } from "@/lib/usage-limits";

const DEFAULT_SECTIONS: SectionType[] = [
  SectionType.HERO,
  SectionType.FEATURES,
  SectionType.TESTIMONIALS,
  SectionType.CTA,
  SectionType.FOOTER,
];

export async function createProjectFromBrief(formData: FormData) {
  const user = await requireUser();

  const businessDescription = (formData.get("businessDescription") as string)?.trim();
  const targetAudience = (formData.get("targetAudience") as string)?.trim();
  const themePresetId = (formData.get("themePreset") as string) || "modern-saas";

  if (!businessDescription) {
    redirect("/dashboard/new?error=Isini+kisaca+anlatmalisin");
  }

  const baseSlug = slugify(truncateAtWordBoundary(businessDescription, 40)) || "proje";
  let slug = baseSlug;
  let suffix = 1;
  while (await prisma.project.findUnique({ where: { slug } })) {
    slug = `${baseSlug}-${++suffix}`;
  }

  const projectName = truncateAtWordBoundary(businessDescription, 60);

  const project = await prisma.project.create({
    data: { name: projectName, slug, userId: user.id },
  });

  try {
    const preset = getThemePreset(themePresetId);
    await prisma.theme.create({
      data: {
        projectId: project.id,
        template: preset.id,
        primaryColor: preset.primaryColor,
        accentColor: preset.accentColor,
        bgColor: preset.bgColor,
        textColor: preset.textColor,
        fontDisplay: preset.fontDisplay,
        fontBody: preset.fontBody,
        borderRadius: preset.borderRadius,
      },
    });

    const page = await prisma.page.create({
      data: { projectId: project.id, status: "PUBLISHED" },
    });

    const briefContext = targetAudience
      ? `${businessDescription} Target audience: ${targetAudience}.`
      : businessDescription;

    const sections = await Promise.all(
      DEFAULT_SECTIONS.map((type, order) =>
        prisma.section.create({ data: { pageId: page.id, type, order } }),
      ),
    );

    const results = await Promise.all(
      sections.map((section) =>
        generateAndSaveSectionContent({
          sectionId: section.id,
          sectionType: section.type,
          locale: "en",
          projectName: briefContext,
          userId: user.id,
          plan: user.plan,
        }),
      ),
    );

    const heroIndex = DEFAULT_SECTIONS.indexOf(SectionType.HERO);
    const heroFields = results[heroIndex] as
      | { headline?: string; subheadline?: string }
      | undefined;

    await prisma.seoMeta.create({
      data: {
        pageId: page.id,
        locale: "en",
        title: heroFields?.headline || projectName,
        description:
          heroFields?.subheadline || truncateAtWordBoundary(businessDescription, 155),
      },
    });

    await prisma.project.update({
      where: { id: project.id },
      data: { published: true },
    });
  } catch (e) {
    // Don't leave a half-built, unpublished "zombie" project behind - the
    // schema's cascade deletes clean up the theme/page/sections/contents
    // created so far in one call.
    await prisma.project.delete({ where: { id: project.id } }).catch(() => {});

    const message =
      e instanceof UsageLimitExceededError
        ? "Aylik AI kullanim limitine ulastin. Plan yukseltmen gerekiyor."
        : "Sayfa olustururken bir hata oldu, tekrar dene.";
    redirect(`/dashboard/new?error=${encodeURIComponent(message)}`);
  }

  redirect(`/dashboard/projects/${project.slug}?launched=1`);
}
