import Link from "next/link";
import { notFound } from "next/navigation";
import { SectionType } from "@prisma/client";
import { requireUser } from "@/lib/get-current-user";
import { prisma } from "@/lib/prisma";
import {
  createSection,
  deleteSection,
  generateSectionContent,
  upsertSeoMeta,
} from "./actions";

export default async function PageDetail({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; pageId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { slug, pageId } = await params;
  const { error } = await searchParams;
  const user = await requireUser();

  const page = await prisma.page.findFirst({
    where: { id: pageId, project: { slug, userId: user.id } },
    include: {
      project: true,
      sections: {
        orderBy: { order: "asc" },
        include: { contents: true },
      },
      seoMeta: true,
    },
  });

  if (!page) notFound();

  const seo = page.seoMeta.find((s) => s.locale === page.project.primaryLocale);

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-10">
      <div>
        <Link
          href={`/dashboard/projects/${slug}`}
          className="text-sm text-gray-500 hover:underline"
        >
          &larr; {page.project.name}
        </Link>
        <h1 className="font-mono text-2xl font-semibold">{page.slug}</h1>
      </div>

      {error && (
        <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>
      )}

      <details className="rounded border p-4" open={!seo}>
        <summary className="cursor-pointer text-sm font-medium">
          SEO ({page.project.primaryLocale})
        </summary>
        <form className="mt-3 flex flex-col gap-2">
          <input type="hidden" name="pageId" value={page.id} />
          <input type="hidden" name="locale" value={page.project.primaryLocale} />
          <input
            name="title"
            placeholder="Title"
            defaultValue={seo?.title}
            required
            className="rounded border px-3 py-2 text-sm"
          />
          <textarea
            name="description"
            placeholder="Description"
            defaultValue={seo?.description}
            required
            className="rounded border px-3 py-2 text-sm"
          />
          <input
            name="ogTitle"
            placeholder="OG title (opsiyonel)"
            defaultValue={seo?.ogTitle ?? ""}
            className="rounded border px-3 py-2 text-sm"
          />
          <input
            name="ogDescription"
            placeholder="OG description (opsiyonel)"
            defaultValue={seo?.ogDescription ?? ""}
            className="rounded border px-3 py-2 text-sm"
          />
          <input
            name="keywords"
            placeholder="anahtar, kelime, virgul, ile"
            defaultValue={seo?.keywords.join(", ") ?? ""}
            className="rounded border px-3 py-2 text-sm"
          />
          <button
            formAction={upsertSeoMeta}
            className="self-start rounded border px-3 py-2 text-sm font-medium hover:bg-gray-50"
          >
            SEO kaydet
          </button>
        </form>
      </details>

      <form className="flex gap-2">
        <input type="hidden" name="pageId" value={page.id} />
        <select name="type" className="rounded border px-3 py-2 text-sm">
          {Object.values(SectionType).map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <button
          formAction={createSection}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Section ekle
        </button>
      </form>

      <ul className="flex flex-col gap-4">
        {page.sections.map((section) => {
          const content = section.contents.find(
            (c) => c.locale === page.project.primaryLocale,
          );

          return (
            <li key={section.id} className="flex flex-col gap-3 rounded border p-4">
              <div className="flex items-center justify-between">
                <span className="font-medium">{section.type}</span>
                <form>
                  <input type="hidden" name="sectionId" value={section.id} />
                  <input type="hidden" name="pageId" value={page.id} />
                  <input type="hidden" name="projectSlug" value={slug} />
                  <button
                    formAction={deleteSection}
                    className="text-sm text-red-600 hover:underline"
                  >
                    Sil
                  </button>
                </form>
              </div>

              <form className="flex gap-2">
                <input type="hidden" name="sectionId" value={section.id} />
                <input type="hidden" name="pageId" value={page.id} />
                <input
                  type="hidden"
                  name="locale"
                  value={page.project.primaryLocale}
                />
                <button
                  formAction={generateSectionContent}
                  className="rounded border px-3 py-2 text-sm font-medium hover:bg-gray-50"
                >
                  AI ile icerik uret ({page.project.primaryLocale})
                </button>
              </form>

              {content && (
                <pre className="overflow-x-auto rounded bg-gray-50 p-3 text-xs">
                  {JSON.stringify(content.fields, null, 2)}
                </pre>
              )}
            </li>
          );
        })}
        {page.sections.length === 0 && (
          <p className="text-sm text-gray-500">Henuz section yok.</p>
        )}
      </ul>
    </div>
  );
}
