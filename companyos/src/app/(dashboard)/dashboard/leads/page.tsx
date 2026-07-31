import { requirePermission } from "@/server/auth/session";
import { listPipelineStages } from "@/server/leads/pipeline";
import { listLeads } from "@/server/leads/service";
import { listCompanies } from "@/server/companies/service";
import { listContacts } from "@/server/contacts/service";
import { CreateLeadDialog } from "@/app/(dashboard)/dashboard/leads/create-lead-dialog";
import { CreateStageDialog } from "@/app/(dashboard)/dashboard/leads/create-stage-dialog";
import { PipelineBoard } from "@/app/(dashboard)/dashboard/leads/pipeline-board";

export default async function LeadsPage() {
  const { organization } = await requirePermission({ lead: ["read"] });

  const [stages, { leads }, { companies }, { contacts }] = await Promise.all([
    listPipelineStages(organization.id),
    listLeads({ organizationId: organization.id, limit: 200 }),
    listCompanies({ organizationId: organization.id, limit: 200 }),
    listContacts({ organizationId: organization.id, limit: 200 }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
          <p className="text-sm text-muted-foreground">{leads.length} open across the pipeline.</p>
        </div>
        <div className="flex gap-2">
          <CreateStageDialog />
          <CreateLeadDialog
            stages={stages.map((s) => ({ id: s.id, name: s.name }))}
            companies={companies.map((c) => ({ id: c.id, name: c.name }))}
            contacts={contacts.map((c) => ({ id: c.id, name: `${c.firstName} ${c.lastName}` }))}
          />
        </div>
      </div>

      <PipelineBoard
        stages={stages.map((s) => ({ id: s.id, name: s.name, isWon: s.isWon, isLost: s.isLost }))}
        leads={leads.map((l) => ({
          id: l.id,
          title: l.title,
          value: Number(l.value),
          probability: l.probability,
          stageId: l.stageId,
          companyName: l.company?.name ?? null,
        }))}
      />
    </div>
  );
}
