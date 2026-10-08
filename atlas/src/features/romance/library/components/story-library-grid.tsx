import Link from "next/link";

interface LibraryUniverse {
  slug: string;
  name: string;
  description: string;
}

interface StoryLibraryGridProps {
  universes: LibraryUniverse[];
}

/** Content-driven - every card comes from a Universe row, never a hard-coded array. */
export function StoryLibraryGrid({ universes }: StoryLibraryGridProps) {
  if (universes.length === 0) {
    return (
      <p className="text-center text-[#c9b8d4]">
        No stories are available yet. Check back soon.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="font-serif text-2xl text-[#f1e9f4]">Choose your story</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        {universes.map((universe) => (
          <Link
            key={universe.slug}
            href={`/romance/${universe.slug}`}
            className="group rounded-lg border border-white/10 bg-[#1c1024]/70 p-5 transition hover:border-[#c9a7e0]/50 hover:bg-[#241530]/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c9a7e0]"
          >
            <h2 className="font-serif text-xl text-[#f1e9f4] group-hover:text-white">
              {universe.name}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[#c9b8d4]">
              {universe.description}
            </p>
            <span className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-md bg-[#5c3a73] px-4 py-2 text-sm font-medium text-white transition group-hover:bg-[#6d4788] sm:w-auto">
              Enter story
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
