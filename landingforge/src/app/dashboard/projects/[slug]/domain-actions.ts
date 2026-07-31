"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/get-current-user";
import { prisma } from "@/lib/prisma";
import {
  addDomainToVercelProject,
  getDomainVerification,
  removeDomainFromVercelProject,
} from "@/lib/vercel-domains";

function normalizeDomain(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
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
  if (!domain) {
    redirect(`/dashboard/projects/${project.slug}?error=Domain+bos+olamaz`);
  }

  try {
    await addDomainToVercelProject(domain);
    await prisma.project.update({
      where: { id: project.id },
      data: { customDomain: domain, customDomainStatus: "PENDING" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Domain eklenemedi";
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
