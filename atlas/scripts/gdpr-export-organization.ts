/**
 * GDPR data-export tool (Article 20 — right to data portability).
 *
 * Run by an operator when a customer requests a copy of their organization's
 * data (see the "Retention and deletion" section of /privacy). Writes a
 * single JSON file locally — never uploads or emails anything itself.
 *
 * Usage:
 *   npx tsx scripts/gdpr-export-organization.ts <organizationId>
 */
import { writeFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const organizationId = process.argv[2];
  if (!organizationId) {
    console.error(
      "Usage: npx tsx scripts/gdpr-export-organization.ts <organizationId>"
    );
    process.exit(1);
  }

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: {
      members: true,
      invites: true,
      conversations: { include: { messages: true } },
      usageRecords: true,
      memories: true,
      insights: true,
      pulseSnapshots: true,
      briefs: true,
      preparedActions: true,
      decisions: { include: { timelineEvents: true } },
      outcomeEvaluations: true,
      learningPatterns: true,
      analyticsEvents: true,
      subscription: true,
    },
  });

  if (!organization) {
    console.error(`No organization found with id "${organizationId}".`);
    process.exit(1);
  }

  // Google connection tokens are encrypted at rest for a reason — export
  // that a connection exists and its metadata, never the ciphertext itself.
  const googleConnections = await prisma.$queryRaw<
    Array<{
      user_id: string;
      google_email: string;
      scopes: string;
      created_at: Date;
      updated_at: Date;
    }>
  >`
    SELECT "user_id", "google_email", "scopes", "created_at", "updated_at"
    FROM "google_connections"
    WHERE "organization_id" = ${organizationId}
  `;

  const exportPayload = {
    exportedAt: new Date().toISOString(),
    organization,
    googleConnections,
  };

  const filename = `gdpr-export-${organizationId}-${Date.now()}.json`;
  writeFileSync(filename, JSON.stringify(exportPayload, null, 2));

  console.log(`Wrote ${filename}`);
  console.log("Record counts:");
  console.log(`  members: ${organization.members.length}`);
  console.log(`  invites: ${organization.invites.length}`);
  console.log(
    `  conversations: ${organization.conversations.length} (messages: ${organization.conversations.reduce((sum, c) => sum + c.messages.length, 0)})`
  );
  console.log(`  memories: ${organization.memories.length}`);
  console.log(`  insights: ${organization.insights.length}`);
  console.log(`  decisions: ${organization.decisions.length}`);
  console.log(`  preparedActions: ${organization.preparedActions.length}`);
  console.log(
    `  outcomeEvaluations: ${organization.outcomeEvaluations.length}`
  );
  console.log(`  learningPatterns: ${organization.learningPatterns.length}`);
  console.log(`  analyticsEvents: ${organization.analyticsEvents.length}`);
  console.log(`  usageRecords: ${organization.usageRecords.length}`);
  console.log(`  googleConnections: ${googleConnections.length}`);
  console.log(
    `  subscription: ${organization.subscription ? "present" : "none"}`
  );
  console.log(
    "\nHandle this file as personal/business-sensitive data: send it directly to the requester over a secure channel, then delete the local copy."
  );
}

main()
  .catch((error) => {
    console.error("Export failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
