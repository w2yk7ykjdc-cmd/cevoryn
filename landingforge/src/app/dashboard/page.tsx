import Link from "next/link";
import { requireUser } from "@/lib/get-current-user";
import { prisma } from "@/lib/prisma";
import { createProject, deleteProject, signOut } from "./actions";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const user = await requireUser();

  const projects = await prisma.project.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Projelerin</h1>
          <p className="text-sm text-gray-500">{user.email}</p>
        </div>
        <form>
          <button
            formAction={signOut}
            className="rounded border px-3 py-2 text-sm font-medium hover:bg-gray-50"
          >
            Cikis yap
          </button>
        </form>
      </div>

      {error && (
        <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>
      )}

      <form className="flex gap-2">
        <input
          name="name"
          placeholder="Yeni proje adi"
          required
          className="flex-1 rounded border px-3 py-2 text-sm"
        />
        <button
          formAction={createProject}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Olustur
        </button>
      </form>

      <ul className="flex flex-col gap-2">
        {projects.map((project) => (
          <li
            key={project.id}
            className="flex items-center justify-between rounded border px-4 py-3"
          >
            <Link
              href={`/dashboard/projects/${project.slug}`}
              className="font-medium hover:underline"
            >
              {project.name}
            </Link>
            <form>
              <input type="hidden" name="projectId" value={project.id} />
              <button
                formAction={deleteProject}
                className="text-sm text-red-600 hover:underline"
              >
                Sil
              </button>
            </form>
          </li>
        ))}
        {projects.length === 0 && (
          <p className="text-sm text-gray-500">Henuz proje yok.</p>
        )}
      </ul>
    </div>
  );
}
