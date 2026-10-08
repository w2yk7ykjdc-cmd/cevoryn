/**
 * GDPR erasure tool (Article 17 — right to erasure), Romance player scope.
 * Mirrors gdpr-delete-organization.ts's shape and safety rules exactly.
 *
 * Deletes the RomancePlayer row; every player-scoped table (characters,
 * sessions, memories, audit logs, notifications, story events,
 * relationship states, canon facts, bargains, promises, debts, the
 * subscription) cascades via `ON DELETE CASCADE` foreign keys already
 * defined in the schema — this script does not need to (and does not)
 * delete child tables individually.
 *
 * Scope: this deletes the player's Romance data only. It does NOT delete
 * the player's Supabase Auth login or any Cevoryn B2B Organization they
 * may separately belong to (ADR-0001: the two are linked only by sharing
 * the same Supabase userId, never by a foreign key) — closing their login
 * entirely is a separate, explicit decision, same caveat as
 * gdpr-delete-organization.ts.
 *
 * Usage:
 *   npx tsx scripts/gdpr-delete-romance-player.ts <userIdOrPlayerId> --confirm
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const identifier = process.argv[2];
  const confirmed = process.argv.includes("--confirm");

  if (!identifier) {
    console.error(
      "Usage: npx tsx scripts/gdpr-delete-romance-player.ts <userIdOrPlayerId> --confirm"
    );
    process.exit(1);
  }

  const player = await prisma.romancePlayer.findFirst({
    where: { OR: [{ userId: identifier }, { id: identifier }] },
    include: {
      _count: {
        select: {
          characters: true,
          sessions: true,
          memories: true,
          storyEvents: true,
          bargains: true,
          promises: true,
        },
      },
    },
  });

  if (!player) {
    console.error(`No RomancePlayer found with userId/id "${identifier}".`);
    process.exit(1);
  }

  console.log(
    `About to permanently delete RomancePlayer "${player.displayName}" (${player.id}, userId ${player.userId}):`
  );
  console.log(`  characters: ${player._count.characters}`);
  console.log(`  sessions: ${player._count.sessions}`);
  console.log(`  memories: ${player._count.memories}`);
  console.log(`  storyEvents: ${player._count.storyEvents}`);
  console.log(`  bargains: ${player._count.bargains}`);
  console.log(`  promises: ${player._count.promises}`);
  console.log(
    "  ...and every other player-scoped record (relationship states, canon facts, debts, audit logs, notifications, the subscription) via cascade."
  );
  console.log(
    "\nThis does NOT delete the player's Supabase Auth login or any separate B2B Organization — see the header comment in this script."
  );

  if (!confirmed) {
    console.log("\nDry run only. Re-run with --confirm to actually delete.");
    return;
  }

  await prisma.romancePlayer.delete({ where: { id: player.id } });
  console.log(`\nDeleted RomancePlayer "${player.displayName}" (${player.id}) and all its data.`);
}

main()
  .catch((error) => {
    console.error("Deletion failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
