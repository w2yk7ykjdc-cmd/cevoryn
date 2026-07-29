"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/get-current-user";
import { prisma } from "@/lib/prisma";

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function createProject(formData: FormData) {
  const user = await requireUser();
  const name = (formData.get("name") as string)?.trim();

  if (!name) {
    redirect("/dashboard?error=Proje+adi+gerekli");
  }

  const baseSlug = slugify(name) || "proje";
  let slug = baseSlug;
  let suffix = 1;

  while (await prisma.project.findUnique({ where: { slug } })) {
    slug = `${baseSlug}-${++suffix}`;
  }

  await prisma.project.create({
    data: { name, slug, userId: user.id },
  });

  revalidatePath("/dashboard");
  redirect(`/dashboard/projects/${slug}`);
}

export async function deleteProject(formData: FormData) {
  const user = await requireUser();
  const projectId = formData.get("projectId") as string;

  await prisma.project.deleteMany({
    where: { id: projectId, userId: user.id },
  });

  revalidatePath("/dashboard");
}
