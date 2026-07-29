import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/get-current-user";
import { prisma } from "@/lib/prisma";
import { createPage, deletePage } from "./actions";

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { slug } = await params;
  const { error } = await searchParams;
  const user = await requireUser();

  const project = await prisma.project.findFirst({
    where: { slug, userId: user.id },
    include: { pages: { orderBy: { createdAt: "asc" } } },
  });

  if (!project) notFound();

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-10">
      <div>
        <Link href="/dashboard" className="text-sm text-gray-500 hover:underline">
          &larr; Projeler
        </Link>
        <h1 className="text-2xl font-semibold">{project.name}</h1>
      </div>

      {error && (
        <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>
      )}

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
            <span className="text-xs text-gray-500">{page.status}</span>
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
          </li>
        ))}
        {project.pages.length === 0 && (
          <p className="text-sm text-gray-500">Henuz sayfa yok.</p>
        )}
      </ul>
    </div>
  );
}
