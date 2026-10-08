/**
 * GDPR data-export tool (Article 20 — right to data portability),
 * Romance player scope. Mirrors gdpr-export-organization.ts's shape and
 * safety rules exactly, scoped by `RomancePlayer` instead of
 * `Organization` (ADR-0001: Romance is never Organization-scoped).
 *
 * Writes a single JSON file locally — never uploads or emails anything
 * itself.
 *
 * Usage:
 *   npx tsx scripts/gdpr-export-romance-player.ts <userIdOrPlayerId>
 *
 * Accepts either the player's Supabase Auth `userId` (what a support
 * request realistically has) or the internal RomancePlayer `id`.
 */
import { writeFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const identifier = process.argv[2];
  if (!identifier) {
    console.error(
      "Usage: npx tsx scripts/gdpr-export-romance-player.ts <userIdOrPlayerId>"
    );
    process.exit(1);
  }

  const player = await prisma.romancePlayer.findFirst({
    where: { OR: [{ userId: identifier }, { id: identifier }] },
    include: {
      subscription: true,
      characters: true,
      sessions: true,
      memories: true,
      auditLogs: true,
      notifications: true,
      storyEvents: true,
      relationshipStates: true,
      canonFacts: true,
      bargains: true,
      promises: true,
      debts: true,
    },
  });

  if (!player) {
    console.error(`No RomancePlayer found with userId/id "${identifier}".`);
    process.exit(1);
  }

  const exportPayload = {
    exportedAt: new Date().toISOString(),
    player,
  };

  const filename = `gdpr-export-romance-player-${player.id}-${Date.now()}.json`;
  writeFileSync(filename, JSON.stringify(exportPayload, null, 2));

  console.log(`Wrote ${filename}`);
  console.log("Record counts:");
  console.log(`  characters: ${player.characters.length}`);
  console.log(`  sessions: ${player.sessions.length}`);
  console.log(`  memories: ${player.memories.length}`);
  console.log(`  auditLogs: ${player.auditLogs.length}`);
  console.log(`  notifications: ${player.notifications.length}`);
  console.log(`  storyEvents: ${player.storyEvents.length}`);
  console.log(`  relationshipStates: ${player.relationshipStates.length}`);
  console.log(`  canonFacts: ${player.canonFacts.length}`);
  console.log(`  bargains: ${player.bargains.length}`);
  console.log(`  promises: ${player.promises.length}`);
  console.log(`  debts: ${player.debts.length}`);
  console.log(`  subscription: ${player.subscription ? "present" : "none"}`);
  console.log(
    "\nHandle this file as personal/sensitive data (this product's content is adult-oriented): send it directly to the requester over a secure channel, then delete the local copy."
  );
}

main()
  .catch((error) => {
    console.error("Export failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
