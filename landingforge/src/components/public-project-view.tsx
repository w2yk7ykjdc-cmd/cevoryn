import type { getPublicPage } from "@/lib/get-public-page";
import { SectionRenderer } from "@/components/section-renderer";

type PublicPageData = NonNullable<Awaited<ReturnType<typeof getPublicPage>>>;

export function PublicProjectView({ data }: { data: PublicPageData }) {
  const { project, page } = data;
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
      {theme?.customCss && (
        <style dangerouslySetInnerHTML={{ __html: theme.customCss }} />
      )}
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

export function buildPublicPageMetadata(data: PublicPageData | null, canonicalUrl: string) {
  if (!data) return {};
  const seo = data.page.seoMeta[0];
  const base = seo
    ? {
        title: seo.title,
        description: seo.description,
        keywords: seo.keywords,
        openGraph: {
          title: seo.ogTitle ?? seo.title,
          description: seo.ogDescription ?? seo.description,
        },
      }
    : { title: data.project.name };

  return { ...base, alternates: { canonical: canonicalUrl } };
}
