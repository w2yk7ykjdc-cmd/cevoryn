import { requireActiveOrganization } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InviteMemberForm } from "@/app/(dashboard)/dashboard/members/invite-member-form";
import { MembersTable } from "@/app/(dashboard)/dashboard/members/members-table";

export default async function MembersPage() {
  const { organization, member: currentMember } = await requireActiveOrganization();

  const [members, invitations] = await Promise.all([
    prisma.member.findMany({
      where: { organizationId: organization.id },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.invitation.findMany({
      where: { organizationId: organization.id, status: "pending" },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
        <p className="text-sm text-muted-foreground">
          Manage who has access to {organization.name} and what they can do.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invite a member</CardTitle>
        </CardHeader>
        <CardContent>
          <InviteMemberForm />
        </CardContent>
      </Card>

      <MembersTable
        currentMemberId={currentMember.id}
        members={members.map((m) => ({
          id: m.id,
          role: m.role,
          name: m.user.name,
          email: m.user.email,
        }))}
        invitations={invitations.map((i) => ({ id: i.id, email: i.email, role: i.role ?? "member" }))}
      />
    </div>
  );
}
