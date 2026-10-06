import { NextResponse } from "next/server";

import { seedRomanceContent } from "@/features/romance/seed/seed-romance-content";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * One-time (idempotent, safe to re-run) admin seed endpoint for Romance
 * content - lets the real shipped "Thornbound" content be loaded into a
 * deployed environment's database without a developer editing production
 * data by hand (brief §23: "don't depend on a developer directly editing
 * production DB"). Gated behind requireUser() (any authenticated Cevoryn
 * account) rather than a public/anonymous route - the operation itself is
 * non-destructive (upserts only, same logic as prisma/seed-romance.ts),
 * so this is intentionally simple rather than building a full RBAC-gated
 * admin surface for a single content package.
 */
export async function GET() {
  const user = await requireUser();

  const result = await seedRomanceContent(prisma);

  console.warn(
    `[romance] admin-seed triggered by ${user.id}: universe=${result.universeSlug} v${result.universeVersion}, ${result.beatCount} beats`
  );

  return NextResponse.json({
    ok: true,
    universe: result.universeName,
    slug: result.universeSlug,
    version: result.universeVersion,
    beats: result.beatCount,
  });
}
