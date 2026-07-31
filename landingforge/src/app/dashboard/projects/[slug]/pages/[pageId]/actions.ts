"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SectionType } from "@prisma/client";
import { requireUser } from "@/lib/get-current-user";
import { prisma } from "@/lib/prisma";
import { generateAndSaveSectionContent } from "@/lib/generate-section-content";
import { UsageLimitExceededError } from "@/lib/usage-limits";

async function ownedPage(pageId: string, userId: string) {
  return prisma.page.findFirst({
    where: { id: pageId, project: { userId } },
    include: { project: true },
  });
}

export async function createSection(formData: FormData) {
  const user = await requireUser();
  const pageId = formData.get("pageId") as string;
  const type = formData.get("type") as SectionType;

  const page = await ownedPage(pageId, user.id);
  if (!page) redirect("/dashboard");

  const sectionCount = await prisma.section.count({ where: { pageId } });

  await prisma.section.create({
    data: { pageId, type, order: sectionCount },
  });

  revalidatePath(`/dashboard/projects/${page.project.slug}/pages/${pageId}`);
}

export async function deleteSection(formData: FormData) {
  const user = await requireUser();
  const sectionId = formData.get("sectionId") as string;
  const pageId = formData.get("pageId") as string;
  const projectSlug = formData.get("projectSlug") as string;

  const page = await ownedPage(pageId, user.id);
  if (!page) redirect("/dashboard");

  await prisma.section.deleteMany({ where: { id: sectionId, pageId } });

  revalidatePath(`/dashboard/projects/${projectSlug}/pages/${pageId}`);
}

export async function generateSectionContent(formData: FormData) {
  const user = await requireUser();
  const sectionId = formData.get("sectionId") as string;
  const pageId = formData.get("pageId") as string;
  const locale = (formData.get("locale") as string) || "en";

  const page = await ownedPage(pageId, user.id);
  if (!page) redirect("/dashboard");

  const section = await prisma.section.findFirst({
    where: { id: sectionId, pageId },
  });
  if (!section) redirect(`/dashboard/projects/${page.project.slug}/pages/${pageId}`);

  try {
    await generateAndSaveSectionContent({
      sectionId,
      sectionType: section.type,
      locale,
      projectName: page.project.name,
      userId: user.id,
      plan: user.plan,
    });
  } catch (e) {
    const message =
      e instanceof UsageLimitExceededError
        ? "Aylik AI kullanim limitine ulastin."
        : "Icerik uretilirken bir hata olustu, tekrar dene.";
    redirect(
      `/dashboard/projects/${page.project.slug}/pages/${pageId}?error=${encodeURIComponent(message)}`,
    );
  }

  revalidatePath(`/dashboard/projects/${page.project.slug}/pages/${pageId}`);
}

export async function upsertSeoMeta(formData: FormData) {
  const user = await requireUser();
  const pageId = formData.get("pageId") as string;
  const locale = formData.get("locale") as string;

  const page = await ownedPage(pageId, user.id);
  if (!page) redirect("/dashboard");

  const title = (formData.get("title") as string)?.trim();
  const description = (formData.get("description") as string)?.trim();
  const ogTitle = (formData.get("ogTitle") as string)?.trim();
  const ogDescription = (formData.get("ogDescription") as string)?.trim();
  const keywords = (formData.get("keywords") as string)
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  await prisma.seoMeta.upsert({
    where: { pageId_locale: { pageId, locale } },
    update: {
      title,
      description,
      ogTitle: ogTitle || null,
      ogDescription: ogDescription || null,
      keywords,
    },
    create: {
      pageId,
      locale,
      title,
      description,
      ogTitle: ogTitle || null,
      ogDescription: ogDescription || null,
      keywords,
    },
  });

  revalidatePath(`/dashboard/projects/${page.project.slug}/pages/${pageId}`);
}
