import type { Metadata } from "next";

import { ReseedButton } from "@/features/romance/admin/components/reseed-button";
import { requireRomancePlayer } from "@/features/romance/player/romance-player-guards";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Romance content admin" };

/**
 * Real admin content tool (brief §23). Gated behind requireRomancePlayer()
 * (auth only, no age-gate - an admin managing content doesn't need to be
 * a verified player) rather than a full RBAC surface, matching the
 * MVP-scoped "data model ships, full admin UI doesn't" boundary from the
 * Product Bible - this one page is the exception, built because the raw
 * API-route workaround used to seed production was explicitly the kind
 * of "developer edits things directly" friction the brief called out.
 */
export default async function RomanceAdminPage() {
  await requireRomancePlayer();

  const [universes, seasons, beats, characters, players, sessions] = await Promise.all([
    prisma.universe.findMany({
      select: { slug: true, name: true, status: true, version: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.season.count(),
    prisma.beat.count(),
    prisma.storyCharacter.count(),
    prisma.romancePlayer.count(),
    prisma.storySession.count(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl text-[#f1e9f4]">Romance content admin</h1>
        <p className="mt-1 text-sm text-[#c9b8d4]">
          Content is versioned and loaded by this page, not edited directly in the database.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[
          { label: "Universes", value: universes.length },
          { label: "Seasons", value: seasons },
          { label: "Beats", value: beats },
          { label: "Characters", value: characters },
          { label: "Players", value: players },
          { label: "Sessions", value: sessions },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-lg border border-white/10 bg-[#1c1024]/70 p-4"
          >
            <p className="text-2xl font-semibold text-[#f1e9f4]">{stat.value}</p>
            <p className="text-xs uppercase tracking-wide text-[#a08bb0]">{stat.label}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-white/10 bg-[#1c1024]/70 p-4">
        <h2 className="font-serif text-lg text-[#f1e9f4]">Universes</h2>
        {universes.length === 0 ? (
          <p className="mt-2 text-sm text-[#c9b8d4]">No content loaded yet.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm text-[#e4d9ea]">
            {universes.map((u) => (
              <li key={`${u.slug}-${u.version}`}>
                {u.name} ({u.slug} v{u.version}) - {u.status}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <ReseedButton />
        <p className="text-xs text-[#a08bb0]">
          Safe to click any time - it only adds or updates content, never deletes a player&apos;s
          story progress.
        </p>
      </div>
    </div>
  );
}
