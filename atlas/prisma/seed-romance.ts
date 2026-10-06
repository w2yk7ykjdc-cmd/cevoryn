/**
 * Seeds the Romance Engine's first real content package. This is the
 * ONLY place story content lives - the Story Library UI reads these rows
 * (Universe/Season/Beat/StoryCharacter), it never hard-codes them, so a
 * second story is an additional seed, not an application-logic change.
 *
 * The actual seeding logic lives in
 * src/features/romance/seed/seed-romance-content.ts, shared with the
 * one-time admin seed route (src/app/api/romance/admin-seed) so there is
 * only one copy of the content to keep in sync.
 *
 * Run: npx tsx prisma/seed-romance.ts (idempotent - safe to re-run).
 */
import { PrismaClient } from "@prisma/client";

import { seedRomanceContent } from "../src/features/romance/seed/seed-romance-content";

const prisma = new PrismaClient();

seedRomanceContent(prisma)
  .then((result) => {
    console.log(
      `Seeded universe "${result.universeName}" (${result.universeSlug} v${result.universeVersion}), ` +
        `${result.beatCount} beats, 3 characters.`
    );
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
