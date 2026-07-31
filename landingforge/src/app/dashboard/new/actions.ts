"use server";

import { redirect } from "next/navigation";
import { SectionType } from "@prisma/client";
import { requireUser } from "@/lib/get-current-user";
import { prisma } from "@/lib/prisma";
import { getThemePreset } from "@/lib/theme-presets";
import { generateAndSaveSectionContent } from "@/lib/generate-section-content";

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

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

  const baseSlug = slugify(businessDescription.slice(0, 40)) || "proje";
  let slug = baseSlug;
  let suffix = 1;
  while (await prisma.project.findUnique({ where: { slug } })) {
    slug = `${baseSlug}-${++suffix}`;
  }

  const projectName = businessDescription.slice(0, 60);

  const project = await prisma.project.create({
    data: { name: projectName, slug, userId: user.id },
  });

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

  let heroFields: { headline?: string; subheadline?: string } | undefined;

  for (let i = 0; i < DEFAULT_SECTIONS.length; i++) {
    const type = DEFAULT_SECTIONS[i];
    const section = await prisma.section.create({
      data: { pageId: page.id, type, order: i },
    });
    const fields = await generateAndSaveSectionContent({
      sectionId: section.id,
      sectionType: type,
      locale: "en",
      projectName: briefContext,
      userId: user.id,
    });
    if (type === SectionType.HERO) {
      heroFields = fields as { headline?: string; subheadline?: string };
    }
  }

  await prisma.seoMeta.create({
    data: {
      pageId: page.id,
      locale: "en",
      title: heroFields?.headline || projectName,
      description: heroFields?.subheadline || businessDescription.slice(0, 155),
    },
  });

  await prisma.project.update({
    where: { id: project.id },
    data: { published: true },
  });

  redirect(`/dashboard/projects/${project.slug}?launched=1`);
}
