import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicPage } from "@/lib/get-public-page";
import { recordPageView } from "@/lib/record-page-view";
import { SectionRenderer } from "@/components/section-renderer";

type Props = {
  params: Promise<{ projectSlug: string; path?: string[] }>;
  searchParams: Promise<{ locale?: string }>;
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { projectSlug, path } = await params;
  const { locale } = await searchParams;
  const data = await getPublicPage(projectSlug, path, locale);
  if (!data) return {};

  const seo = data.page.seoMeta[0];
  if (!seo) return { title: data.project.name };

  return {
    title: seo.title,
    description: seo.description,
    keywords: seo.keywords,
    openGraph: {
      title: seo.ogTitle ?? seo.title,
      description: seo.ogDescription ?? seo.description,
    },
  };
}

export default async function PublicProjectPage({ params, searchParams }: Props) {
  const { projectSlug, path } = await params;
  const { locale } = await searchParams;
  const data = await getPublicPage(projectSlug, path, locale);
  if (!data) notFound();

  const { project, page, locale: resolvedLocale } = data;

  await recordPageView(page.id, resolvedLocale);

  const theme = project.theme;
  const style = {
    "--primary": theme?.primaryColor ?? "#2563EB",
    "--accent": theme?.accentColor ?? "#F59E0B",
    "--radius": `${theme?.borderRadius ?? 8}px`,
    backgroundColor: theme?.bgColor ?? "#FFFFFF",
    color: theme?.textColor ?? "#111827",
  } as React.CSSProperties;

  return (
    <div style={style} className="min-h-screen">
      {theme?.customCss && <style dangerouslySetInnerHTML={{ __html: theme.customCss }} />}
      {page.sections.map((section) => (
        <SectionRenderer
          key={section.id}
          type={section.type}
          fields={section.contents[0]?.fields as Record<string, unknown> | undefined}
        />
      ))}
    </div>
  );
}
