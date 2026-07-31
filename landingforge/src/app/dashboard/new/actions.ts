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

function isRedirectError(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "digest" in e &&
    typeof (e as { digest: unknown }).digest === "string" &&
    (e as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

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

    // allSettled, not all: one section's AI call failing shouldn't discard
    // the tokens already spent on the other four. Only the hero is treated
    // as load-bearing (see below) - everything else degrades gracefully to
    // "empty, retry later from the existing per-section generate button".
    const outcomes = await Promise.allSettled(
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
    const heroOutcome = outcomes[heroIndex];

    // No hero means no headline and no SEO fallback content - that's not a
    // publishable page, so treat it the same as a total failure.
    if (heroOutcome.status === "rejected") {
      throw heroOutcome.reason;
    }

    const heroFields = heroOutcome.value as {
      headline?: string;
      subheadline?: string;
    };

    const failedTypes = outcomes
      .map((outcome, i) => (outcome.status === "rejected" ? DEFAULT_SECTIONS[i] : null))
      .filter((type): type is SectionType => type !== null);

    await prisma.seoMeta.create({
      data: {
        pageId: page.id,
        locale: "en",
        title: heroFields.headline || projectName,
        description:
          heroFields.subheadline || truncateAtWordBoundary(businessDescription, 155),
      },
    });

    await prisma.project.update({
      where: { id: project.id },
      data: { published: true },
    });

    const query =
      failedTypes.length > 0
        ? `launched=1&partial=${encodeURIComponent(failedTypes.join(","))}`
        : "launched=1";

    redirect(`/dashboard/projects/${project.slug}?${query}`);
  } catch (e) {
    if (isRedirectError(e)) throw e;

    // Only reachable when nothing worth keeping was produced (hero failed,
    // or an earlier setup step threw) - clean up so no half-built,
    // unpublished project lingers. Cascade deletes take theme/page/
    // sections/contents with it in one call.
    await prisma.project.delete({ where: { id: project.id } }).catch(() => {});

    const message =
      e instanceof UsageLimitExceededError
        ? "Aylik AI kullanim limitine ulastin. Plan yukseltmen gerekiyor."
        : "Sayfa olustururken bir hata oldu, tekrar dene.";
    redirect(`/dashboard/new?error=${encodeURIComponent(message)}`);
  }
}
