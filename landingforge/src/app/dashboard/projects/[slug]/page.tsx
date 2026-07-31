import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/get-current-user";
import { prisma } from "@/lib/prisma";
import { CopyLinkButton } from "@/components/copy-link-button";
import { createPage, deletePage, togglePagePublished, upsertTheme } from "./actions";
import { addCustomDomain, refreshDomainStatus, removeCustomDomain } from "./domain-actions";
import { toggleProjectPublished } from "../../actions";

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string; launched?: string; partial?: string }>;
}) {
  const { slug } = await params;
  const { error, launched, partial } = await searchParams;
  const user = await requireUser();

  const project = await prisma.project.findFirst({
    where: { slug, userId: user.id },
    include: { pages: { orderBy: { createdAt: "asc" } }, theme: true },
  });

  if (!project) notFound();

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-10">
      <div className="flex items-start justify-between">
        <div>
          <Link href="/dashboard" className="text-sm text-gray-500 hover:underline">
            &larr; Projeler
          </Link>
          <h1 className="text-2xl font-semibold">{project.name}</h1>
        </div>
        <form>
          <input type="hidden" name="projectId" value={project.id} />
          <button
            formAction={toggleProjectPublished}
            className="rounded border px-3 py-2 text-sm font-medium hover:bg-gray-50"
          >
            {project.published ? "Yayindan kaldir" : "Yayinla"}
          </button>
        </form>
      </div>

      {project.published && (
        <p className="text-sm text-gray-500">
          Yayinda:{" "}
          <a
            href={`/${project.slug}`}
            className="underline"
            target="_blank"
            rel="noreferrer"
          >
            /{project.slug}
          </a>
        </p>
      )}

      {launched && (
        <div className="rounded border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          <p className="font-medium">Sayfan yayinda!</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="rounded bg-white px-2 py-1 text-xs">
              {process.env.NEXT_PUBLIC_APP_URL}/{project.slug}
            </code>
            <CopyLinkButton url={`${process.env.NEXT_PUBLIC_APP_URL}/${project.slug}`} />
          </div>
          {partial && project.pages[0] && (
            <p className="mt-2 text-xs text-amber-700">
              Su bolumler olusturulamadi: {partial.split(",").join(", ")}. Asagidaki{" "}
              <Link href={`/dashboard/projects/${project.slug}/pages/${project.pages[0].id}`} className="underline">
                sayfa detayindan
              </Link>{" "}
              tek tek yeniden uretebilirsin.
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>
      )}

      <details className="rounded border p-4">
        <summary className="cursor-pointer text-sm font-medium">Tema</summary>
        <form className="mt-3 grid grid-cols-2 gap-3">
          <input type="hidden" name="projectId" value={project.id} />
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            Ana renk
            <input
              type="color"
              name="primaryColor"
              defaultValue={project.theme?.primaryColor ?? "#2563EB"}
              className="h-9 w-full rounded border"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            Vurgu rengi
            <input
              type="color"
              name="accentColor"
              defaultValue={project.theme?.accentColor ?? "#F59E0B"}
              className="h-9 w-full rounded border"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            Arkaplan
            <input
              type="color"
              name="bgColor"
              defaultValue={project.theme?.bgColor ?? "#FFFFFF"}
              className="h-9 w-full rounded border"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            Metin rengi
            <input
              type="color"
              name="textColor"
              defaultValue={project.theme?.textColor ?? "#111827"}
              className="h-9 w-full rounded border"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            Baslik fontu
            <input
              name="fontDisplay"
              defaultValue={project.theme?.fontDisplay ?? "Inter"}
              className="rounded border px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            Govde fontu
            <input
              name="fontBody"
              defaultValue={project.theme?.fontBody ?? "Inter"}
              className="rounded border px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            Kose yuvarlakligi (px)
            <input
              type="number"
              name="borderRadius"
              min={0}
              max={32}
              defaultValue={project.theme?.borderRadius ?? 8}
              className="rounded border px-3 py-2 text-sm"
            />
          </label>
          <label className="col-span-2 flex flex-col gap-1 text-xs text-gray-500">
            Ozel CSS (opsiyonel)
            <textarea
              name="customCss"
              defaultValue={project.theme?.customCss ?? ""}
              rows={3}
              className="rounded border px-3 py-2 font-mono text-xs"
            />
          </label>
          <button
            formAction={upsertTheme}
            className="col-span-2 self-start rounded border px-3 py-2 text-sm font-medium hover:bg-gray-50"
          >
            Temayi kaydet
          </button>
        </form>
      </details>

      <details className="rounded border p-4">
        <summary className="cursor-pointer text-sm font-medium">Ozel domain</summary>
        <div className="mt-3 flex flex-col gap-3 text-sm">
          {project.customDomain ? (
            <>
              <p>
                <span className="font-mono">{project.customDomain}</span>{" "}
                <span
                  className={
                    project.customDomainStatus === "VERIFIED"
                      ? "text-green-600"
                      : project.customDomainStatus === "FAILED"
                        ? "text-red-600"
                        : "text-amber-600"
                  }
                >
                  ({project.customDomainStatus})
                </span>
              </p>
              {project.customDomainStatus !== "VERIFIED" && (
                <p className="text-xs text-gray-500">
                  DNS ayarlarinda domainin icin bir CNAME kaydi olustur, deger
                  olarak <code className="rounded bg-gray-100 px-1">cname.vercel-dns.com</code>{" "}
                  girip birkac dakika bekle, sonra &quot;Durumu yenile&quot;ye bas.
                </p>
              )}
              <div className="flex gap-2">
                <form>
                  <input type="hidden" name="projectId" value={project.id} />
                  <button
                    formAction={refreshDomainStatus}
                    className="rounded border px-3 py-2 text-xs hover:bg-gray-50"
                  >
                    Durumu yenile
                  </button>
                </form>
                <form>
                  <input type="hidden" name="projectId" value={project.id} />
                  <button
                    formAction={removeCustomDomain}
                    className="rounded border px-3 py-2 text-xs text-red-600 hover:bg-gray-50"
                  >
                    Kaldir
                  </button>
                </form>
              </div>
            </>
          ) : (
            <form className="flex gap-2">
              <input type="hidden" name="projectId" value={project.id} />
              <input
                name="domain"
                placeholder="ornek.com"
                className="flex-1 rounded border px-3 py-2 text-sm"
              />
              <button
                formAction={addCustomDomain}
                className="rounded border px-3 py-2 text-sm font-medium hover:bg-gray-50"
              >
                Domain ekle
              </button>
            </form>
          )}
        </div>
      </details>

      <form className="flex gap-2">
        <input type="hidden" name="projectId" value={project.id} />
        <input
          name="slug"
          placeholder="/sayfa-yolu"
          className="flex-1 rounded border px-3 py-2 text-sm"
        />
        <button
          formAction={createPage}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Sayfa ekle
        </button>
      </form>

      <ul className="flex flex-col gap-2">
        {project.pages.map((page) => (
          <li
            key={page.id}
            className="flex items-center justify-between rounded border px-4 py-3"
          >
            <Link
              href={`/dashboard/projects/${project.slug}/pages/${page.id}`}
              className="font-mono text-sm hover:underline"
            >
              {page.slug}
            </Link>
            <div className="flex items-center gap-3">
              <form>
                <input type="hidden" name="pageId" value={page.id} />
                <input type="hidden" name="projectSlug" value={project.slug} />
                <button
                  formAction={togglePagePublished}
                  className="text-xs text-gray-500 hover:underline"
                >
                  {page.status}
                </button>
              </form>
              <form>
                <input type="hidden" name="pageId" value={page.id} />
                <input type="hidden" name="projectSlug" value={project.slug} />
                <button
                  formAction={deletePage}
                  className="text-sm text-red-600 hover:underline"
                >
                  Sil
                </button>
              </form>
            </div>
          </li>
        ))}
        {project.pages.length === 0 && (
          <p className="text-sm text-gray-500">Henuz sayfa yok.</p>
        )}
      </ul>
    </div>
  );
}
