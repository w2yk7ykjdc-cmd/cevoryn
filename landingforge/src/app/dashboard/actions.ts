"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/get-current-user";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { RESERVED_SLUGS, slugify } from "@/lib/slugify";

export async function createProject(formData: FormData) {
  const user = await requireUser();
  const name = (formData.get("name") as string)?.trim();

  if (!name) {
    redirect("/dashboard?error=Proje+adi+gerekli");
  }

  const baseSlug = slugify(name) || "proje";
  let slug = baseSlug;
  let suffix = 1;

  while (
    RESERVED_SLUGS.has(slug) ||
    (await prisma.project.findUnique({ where: { slug } }))
  ) {
    slug = `${baseSlug}-${++suffix}`;
  }

  await prisma.project.create({
    data: { name, slug, userId: user.id },
  });

  revalidatePath("/dashboard");
  redirect(`/dashboard/projects/${slug}`);
}

export async function toggleProjectPublished(formData: FormData) {
  const user = await requireUser();
  const projectId = formData.get("projectId") as string;

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: user.id },
  });
  if (!project) return;

  const willPublish = !project.published;

  if (willPublish) {
    // "Yayinda" only means anything if a visitor actually reaches a live
    // page - a project can be marked published with every page still
    // DRAFT (the default for manually created pages), which showed a
    // "Yayinda" badge and a public link that 404s. Require at least one
    // PUBLISHED page before flipping the project-level flag.
    const hasPublishedPage = await prisma.page.findFirst({
      where: { projectId: project.id, status: "PUBLISHED" },
      select: { id: true },
    });
    if (!hasPublishedPage) {
      redirect(
        `/dashboard/projects/${project.slug}?error=${encodeURIComponent(
          "Yayinlamadan once en az bir sayfayi yayinlamalisin.",
        )}`,
      );
    }
  }

  await prisma.project.update({
    where: { id: project.id },
    data: { published: willPublish },
  });

  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/projects/${project.slug}`);
}

export async function deleteProject(formData: FormData) {
  const user = await requireUser();
  const projectId = formData.get("projectId") as string;

  await prisma.project.deleteMany({
    where: { id: projectId, userId: user.id },
  });

  revalidatePath("/dashboard");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
