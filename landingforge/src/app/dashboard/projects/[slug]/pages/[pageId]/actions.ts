"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SectionType, UsageType } from "@prisma/client";
import { requireUser } from "@/lib/get-current-user";
import { prisma } from "@/lib/prisma";
import { getOpenAIClient } from "@/lib/openai";
import { getSectionSchema } from "@/lib/section-schemas";

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

  const { name, description, schema } = getSectionSchema(section.type);

  const response = await getOpenAIClient().responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content:
          "You write concise, persuasive landing page copy. Respond only with the requested fields, in the requested locale, with no placeholder brackets.",
      },
      {
        role: "user",
        content: `Product/project name: "${page.project.name}". Write copy for a "${section.type}" section, locale "${locale}". ${description}.`,
      },
    ],
    text: {
      format: { type: "json_schema", name, schema, strict: true },
    },
  });

  const fields = JSON.parse(response.output_text);

  await prisma.$transaction([
    prisma.sectionContent.upsert({
      where: { sectionId_locale: { sectionId, locale } },
      update: { fields, aiGenerated: true, aiReviewedAt: null, humanEdited: false },
      create: { sectionId, locale, fields, aiGenerated: true },
    }),
    prisma.apiUsage.create({
      data: {
        userId: user.id,
        type: UsageType.GENERATE_COPY,
        tokensUsed: response.usage?.total_tokens ?? 0,
        locale,
      },
    }),
  ]);

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
