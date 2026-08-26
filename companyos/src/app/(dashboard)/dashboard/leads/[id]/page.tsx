import { notFound } from "next/navigation";
import { requirePermission } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { getLead } from "@/server/leads/service";
import { listPipelineStages } from "@/server/leads/pipeline";
import { LeadDetail } from "@/app/(dashboard)/dashboard/leads/[id]/lead-detail";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { organization } = await requirePermission({ lead: ["read"] });

  const [lead, stages, members] = await Promise.all([
    getLead(organization.id, id),
    listPipelineStages(organization.id),
    prisma.member.findMany({
      where: { organizationId: organization.id },
      include: { user: { select: { id: true, name: true } } },
    }),
  ]);

  if (!lead) {
    notFound();
  }

  return (
    <LeadDetail
      lead={{
        ...lead,
        value: Number(lead.value),
      }}
      stages={stages.map((s) => ({ id: s.id, name: s.name }))}
      members={members.map((m) => ({ id: m.user.id, name: m.user.name }))}
    />
  );
}
