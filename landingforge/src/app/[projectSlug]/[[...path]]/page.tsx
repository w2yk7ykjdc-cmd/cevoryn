import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicPage } from "@/lib/get-public-page";
import { recordPageView } from "@/lib/record-page-view";
import {
  PublicProjectView,
  buildPublicPageMetadata,
} from "@/components/public-project-view";

type Props = {
  params: Promise<{ projectSlug: string; path?: string[] }>;
  searchParams: Promise<{ locale?: string }>;
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { projectSlug, path } = await params;
  const { locale } = await searchParams;
  const data = await getPublicPage(projectSlug, path, locale);
  const canonicalPath = path && path.length > 0 ? `/${path.join("/")}` : "";
  const canonicalUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/${projectSlug}${canonicalPath}`;
  return buildPublicPageMetadata(data, canonicalUrl);
}

export default async function PublicProjectPage({ params, searchParams }: Props) {
  const { projectSlug, path } = await params;
  const { locale } = await searchParams;
  const data = await getPublicPage(projectSlug, path, locale);
  if (!data) notFound();

  await recordPageView(data.page.id, data.locale);

  return <PublicProjectView data={data} />;
}
