/**
 * GDPR erasure tool (Article 17 — right to erasure), organization scope.
 *
 * Run by an operator when a customer requests their organization's data be
 * deleted (see the "Retention and deletion" section of /privacy). Deletes
 * the Organization row; every organization-scoped table (members, invites,
 * conversations/messages, memories, insights, decisions, prepared actions,
 * usage records, the subscription, and Google connections) cascades via
 * `ON DELETE CASCADE` foreign keys already defined in the schema — this
 * script does not need to (and does not) delete child tables individually.
 *
 * Scope: this deletes the organization's business data only. It does NOT
 * delete any member's Supabase Auth login — a member may belong to other
 * organizations, and deciding whether to close their login too is a
 * separate, explicit decision. If this was a member's only organization
 * and the request was to delete their account entirely, close their login
 * separately via the Supabase dashboard or `admin.auth.admin.deleteUser`.
 *
 * Usage:
 *   npx tsx scripts/gdpr-delete-organization.ts <organizationId> --confirm
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const organizationId = process.argv[2];
  const confirmed = process.argv.includes("--confirm");

  if (!organizationId) {
    console.error(
      "Usage: npx tsx scripts/gdpr-delete-organization.ts <organizationId> --confirm"
    );
    process.exit(1);
  }

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: {
      members: { select: { id: true, userId: true, displayName: true } },
      _count: {
        select: {
          conversations: true,
          decisions: true,
          memories: true,
          insights: true,
        },
      },
    },
  });

  if (!organization) {
    console.error(`No organization found with id "${organizationId}".`);
    process.exit(1);
  }

  console.log(
    `About to permanently delete organization "${organization.name}" (${organization.id}):`
  );
  console.log(`  members: ${organization.members.length}`);
  console.log(`  conversations: ${organization._count.conversations}`);
  console.log(`  decisions: ${organization._count.decisions}`);
  console.log(`  memories: ${organization._count.memories}`);
  console.log(`  insights: ${organization._count.insights}`);
  console.log(
    "  ...and every other organization-scoped record (usage, briefs, subscription, Google connections) via cascade."
  );
  console.log(
    "\nThis does NOT delete member login accounts — see the header comment in this script."
  );

  if (!confirmed) {
    console.log("\nDry run only. Re-run with --confirm to actually delete.");
    return;
  }

  await prisma.organization.delete({ where: { id: organizationId } });
  console.log(
    `\nDeleted organization "${organization.name}" (${organization.id}) and all its data.`
  );
}

main()
  .catch((error) => {
    console.error("Deletion failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
