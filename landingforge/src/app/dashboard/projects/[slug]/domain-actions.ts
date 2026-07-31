"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/get-current-user";
import { prisma } from "@/lib/prisma";
import {
  addDomainToVercelProject,
  getDomainVerification,
  removeDomainFromVercelProject,
} from "@/lib/vercel-domains";

const DOMAIN_PATTERN = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

function normalizeDomain(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
}

function friendlyDomainError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("already") || lower.includes("in use")) {
    return "Bu domain zaten baska bir projede kullaniliyor.";
  }
  if (lower.includes("not configured")) {
    return "Domain entegrasyonu henuz yapilandirilmamis, lutfen daha sonra tekrar dene.";
  }
  return "Domain eklenirken bir hata olustu, tekrar dene.";
}

export async function addCustomDomain(formData: FormData) {
  const user = await requireUser();
  const projectId = formData.get("projectId") as string;
  const domainInput = (formData.get("domain") as string) ?? "";

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: user.id },
  });
  if (!project) redirect("/dashboard");

  const domain = normalizeDomain(domainInput);
  if (!domain || !DOMAIN_PATTERN.test(domain)) {
    redirect(
      `/dashboard/projects/${project.slug}?error=${encodeURIComponent("Gecerli bir domain gir (ornek.com gibi)")}`,
    );
  }

  try {
    await addDomainToVercelProject(domain);
  } catch (e) {
    const message = e instanceof Error ? friendlyDomainError(e.message) : "Domain eklenemedi";
    redirect(`/dashboard/projects/${project.slug}?error=${encodeURIComponent(message)}`);
  }

  try {
    await prisma.project.update({
      where: { id: project.id },
      data: { customDomain: domain, customDomainStatus: "PENDING" },
    });
  } catch (e) {
    // Vercel now has the domain but our own record failed to save (most
    // likely one of our other projects already claims it) - roll the
    // Vercel side back so the two never drift out of sync.
    await removeDomainFromVercelProject(domain).catch(() => {});

    const message =
      e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002"
        ? "Bu domain zaten baska bir projene bagli."
        : "Domain kaydedilirken bir hata olustu, tekrar dene.";
    redirect(`/dashboard/projects/${project.slug}?error=${encodeURIComponent(message)}`);
  }

  revalidatePath(`/dashboard/projects/${project.slug}`);
}

export async function refreshDomainStatus(formData: FormData) {
  const user = await requireUser();
  const projectId = formData.get("projectId") as string;

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: user.id },
  });
  if (!project?.customDomain) redirect("/dashboard");

  try {
    const result = await getDomainVerification(project.customDomain);
    await prisma.project.update({
      where: { id: project.id },
      data: { customDomainStatus: result.verified ? "VERIFIED" : "PENDING" },
    });
  } catch {
    await prisma.project.update({
      where: { id: project.id },
      data: { customDomainStatus: "FAILED" },
    });
  }

  revalidatePath(`/dashboard/projects/${project.slug}`);
}

export async function removeCustomDomain(formData: FormData) {
  const user = await requireUser();
  const projectId = formData.get("projectId") as string;

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: user.id },
  });
  if (!project) redirect("/dashboard");

  if (project.customDomain) {
    try {
      await removeDomainFromVercelProject(project.customDomain);
    } catch {
      // Best-effort: Vercel-side cleanup may fail (not configured, already
      // removed, network hiccup) but the user's own record should not get
      // stuck because of it.
    }
  }

  await prisma.project.update({
    where: { id: project.id },
    data: { customDomain: null, customDomainStatus: "NONE" },
  });

  revalidatePath(`/dashboard/projects/${project.slug}`);
}
