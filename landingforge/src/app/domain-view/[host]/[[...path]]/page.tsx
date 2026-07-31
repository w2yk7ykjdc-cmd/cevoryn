import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getPublicPage } from "@/lib/get-public-page";
import { recordPageView } from "@/lib/record-page-view";
import {
  PublicProjectView,
  buildPublicPageMetadata,
} from "@/components/public-project-view";

type Props = {
  params: Promise<{ host: string; path?: string[] }>;
  searchParams: Promise<{ locale?: string }>;
};

// Reached only via the host-based rewrite in src/proxy.ts: a visitor's
// custom domain has no project slug in its URL, so we resolve it here
// (Node.js runtime, unlike the Edge middleware) before rendering the exact
// same view as the path-based /[projectSlug] route.
async function resolveSlug(host: string) {
  const project = await prisma.project.findFirst({
    where: { customDomain: host, published: true },
    select: { slug: true },
  });
  return project?.slug ?? null;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { host, path } = await params;
  const { locale } = await searchParams;
  const slug = await resolveSlug(host);
  if (!slug) return {};
  const data = await getPublicPage(slug, path, locale);
  return buildPublicPageMetadata(data);
}

export default async function CustomDomainPage({ params, searchParams }: Props) {
  const { host, path } = await params;
  const { locale } = await searchParams;

  const slug = await resolveSlug(host);
  if (!slug) notFound();

  const data = await getPublicPage(slug, path, locale);
  if (!data) notFound();

  await recordPageView(data.page.id, data.locale);

  return <PublicProjectView data={data} />;
}
