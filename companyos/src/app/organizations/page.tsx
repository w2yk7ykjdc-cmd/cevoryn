import { requireSession } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { OrganizationPicker } from "@/app/organizations/organization-picker";

export default async function OrganizationsPage() {
  const session = await requireSession();

  const memberships = await prisma.member.findMany({
    where: { userId: session.user.id },
    include: { organization: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Your workspaces</h1>
        <p className="text-sm text-muted-foreground">
          Pick a workspace to continue, or create a new one.
        </p>
      </div>
      <OrganizationPicker
        organizations={memberships.map((m) => ({
          id: m.organization.id,
          name: m.organization.name,
          slug: m.organization.slug,
          role: m.role,
        }))}
      />
    </div>
  );
}
