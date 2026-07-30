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

export async function togglePagePublished(formData: FormData) {
  const user = await requireUser();
  const pageId = formData.get("pageId") as string;
  const projectSlug = formData.get("projectSlug") as string;

  const page = await prisma.page.findFirst({
    where: { id: pageId, project: { userId: user.id } },
  });
  if (!page) return;

  await prisma.page.update({
    where: { id: page.id },
    data: {
      status:
        page.status === PageStatus.PUBLISHED
          ? PageStatus.DRAFT
          : PageStatus.PUBLISHED,
    },
  });

  revalidatePath(`/dashboard/projects/${projectSlug}`);
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
  revalidatePath(`/dashboard/projects/${projectSlug}`);
}
