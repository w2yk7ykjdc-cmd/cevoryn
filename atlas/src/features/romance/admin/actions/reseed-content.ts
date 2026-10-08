"use server";

import { seedRomanceContent } from "@/features/romance/seed/seed-romance-content";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { ActionResult } from "@/types";

/**
 * Real admin content tool (brief §23: "must be able to manage stories at
 * least at an internal/admin level... don't depend on a developer
 * directly editing production DB"). Idempotent - safe to click more than
 * once. Gated behind requireUser() only (any authenticated Cevoryn
 * account), same as the raw GET /api/romance/admin-seed endpoint this
 * page replaces as the primary way to trigger it.
 */
export async function reseedRomanceContentAction(): Promise<
  ActionResult<{ universeName: string; beatCount: number }>
> {
  const user = await requireUser();

  const result = await seedRomanceContent(prisma);

  console.warn(
    `[romance] content reseeded by ${user.id}: universe=${result.universeSlug} v${result.universeVersion}, ${result.beatCount} beats`
  );

  return {
    success: true,
    data: { universeName: result.universeName, beatCount: result.beatCount },
  };
}
