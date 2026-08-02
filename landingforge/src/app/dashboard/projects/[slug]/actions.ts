"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { PageStatus } from "@prisma/client";
import { requireUser } from "@/lib/get-current-user";
import { prisma } from "@/lib/prisma";

function normalizeSlug(input: string) {
  const trimmed = input.trim();
  if (!trimmed || trimmed === "/") return "/";
  const cleaned = trimmed
    .toLowerCase()
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-z0-9/-]+/g, "-");
  return `/${cleaned}`;
}

export async function createPage(formData: FormData) {
  const user = await requireUser();
  const projectId = formData.get("projectId") as string;
  const slugInput = (formData.get("slug") as string) ?? "";

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: user.id },
  });
  if (!project) redirect("/dashboard");

  const slug = normalizeSlug(slugInput);

  const existing = await prisma.page.findUnique({
    where: { projectId_slug: { projectId, slug } },
  });
  if (existing) {
    redirect(`/dashboard/projects/${project.slug}?error=Bu+sayfa+zaten+var`);
  }

  await prisma.page.create({ data: { projectId, slug } });

  revalidatePath(`/dashboard/projects/${project.slug}`);
}

// A project marked "published" with no PUBLISHED page left is a public
// link that 404s - keep the project-level flag honest whenever a page
// stops being the last live one.
async function syncProjectPublishedFlag(projectId: string) {
  const hasPublishedPage = await prisma.page.findFirst({
    where: { projectId, status: PageStatus.PUBLISHED },
    select: { id: true },
  });
  if (!hasPublishedPage) {
    await prisma.project.updateMany({
      where: { id: projectId, published: true },
      data: { published: false },
    });
  }
}

export async function togglePagePublished(formData: FormData) {
  const user = await requireUser();
  const pageId = formData.get("pageId") as string;
  const projectSlug = formData.get("projectSlug") as string;

  const page = await prisma.page.findFirst({
    where: { id: pageId, project: { userId: user.id } },
  });
  if (!page) return;

  const wasPublished = page.status === PageStatus.PUBLISHED;

  await prisma.page.update({
    where: { id: page.id },
    data: { status: wasPublished ? PageStatus.DRAFT : PageStatus.PUBLISHED },
  });

  if (wasPublished) {
    await syncProjectPublishedFlag(page.projectId);
  }

  revalidatePath(`/dashboard/projects/${projectSlug}`);
}

export async function upsertTheme(formData: FormData) {
  const user = await requireUser();
  const projectId = formData.get("projectId") as string;

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: user.id },
  });
  if (!project) redirect("/dashboard");

  const primaryColor = formData.get("primaryColor") as string;
  const accentColor = formData.get("accentColor") as string;
  const bgColor = formData.get("bgColor") as string;
  const textColor = formData.get("textColor") as string;
  const fontDisplay = (formData.get("fontDisplay") as string)?.trim() || "Inter";
  const fontBody = (formData.get("fontBody") as string)?.trim() || "Inter";
  const borderRadius = Number(formData.get("borderRadius")) || 8;
  const customCss = (formData.get("customCss") as string)?.trim() || null;

  await prisma.theme.upsert({
    where: { projectId },
    update: {
      primaryColor,
      accentColor,
      bgColor,
      textColor,
      fontDisplay,
      fontBody,
      borderRadius,
      customCss,
    },
    create: {
      projectId,
      primaryColor,
      accentColor,
      bgColor,
      textColor,
      fontDisplay,
      fontBody,
      borderRadius,
      customCss,
    },
  });

  revalidatePath(`/dashboard/projects/${project.slug}`);
}

export async function deletePage(formData: FormData) {
  const user = await requireUser();
  const pageId = formData.get("pageId") as string;
  const projectSlug = formData.get("projectSlug") as string;

  const page = await prisma.page.findFirst({
    where: { id: pageId, project: { userId: user.id } },
  });
  if (!page) return;

  await prisma.page.delete({ where: { id: pageId } });

  if (page.status === PageStatus.PUBLISHED) {
    await syncProjectPublishedFlag(page.projectId);
  }

  revalidatePath(`/dashboard/projects/${projectSlug}`);
}
