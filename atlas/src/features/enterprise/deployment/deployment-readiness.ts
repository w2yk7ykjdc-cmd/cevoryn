/**
 * Private Deployment readiness checklist (Phase 2, section 16).
 *
 * Status: this is real, queryable data describing the gap between "runs on
 * shared Vercel + shared Supabase Postgres" (true today) and "runs as a
 * dedicated/private deployment for one customer" (not built) - not
 * prose documentation. It exists as typed data, not a markdown file,
 * so it can genuinely be rendered on a future admin/enterprise-readiness
 * page rather than living only as a comment nobody re-reads. Nothing here
 * claims a requirement is met unless `satisfied: true` - most are not, and
 * this module does not pretend otherwise.
 */

export interface DeploymentRequirement {
  id: string;
  area:
    "DATA_ISOLATION" | "SECRETS" | "NETWORKING" | "COMPUTE" | "OBSERVABILITY";
  description: string;
  satisfied: boolean;
  notes: string;
}

export const PRIVATE_DEPLOYMENT_REQUIREMENTS: DeploymentRequirement[] = [
  {
    id: "tenant-isolation-row-level",
    area: "DATA_ISOLATION",
    description:
      "Every query is scoped by organizationId at the application layer.",
    satisfied: true,
    notes:
      "True today for all Radar/Brain services - see the organizationId-scoped Prisma queries throughout src/features/**. A dedicated deployment for one customer would not strictly need this, but keeping it means the same codebase serves both models.",
  },
  {
    id: "dedicated-database",
    area: "DATA_ISOLATION",
    description:
      "One organization's data can be provisioned in its own database/schema, not just its own rows.",
    satisfied: false,
    notes:
      "Not built. Would require the DATABASE_URL a request resolves to be organization-dependent (env.ts currently reads one process-wide DATABASE_URL) - a real infrastructure project, not a code change alone.",
  },
  {
    id: "secrets-per-tenant",
    area: "SECRETS",
    description:
      "API keys/credentials (AI provider, email, billing) can be overridden per organization.",
    satisfied: false,
    notes:
      "Not built. All provider credentials are process-wide env vars today (see src/lib/env.ts).",
  },
  {
    id: "outbound-network-allowlist",
    area: "NETWORKING",
    description:
      "Outbound requests from Radar adapters can be restricted to a customer-approved allowlist.",
    satisfied: false,
    notes:
      "Partially related groundwork exists: fetchWithRetry() + isSafePublicUrl() (src/features/radar/signals/adapters/) already block private/loopback targets, but that is an SSRF guard, not a configurable customer allowlist.",
  },
  {
    id: "background-jobs-isolated",
    area: "COMPUTE",
    description:
      "One customer's background job load cannot starve or slow another's.",
    satisfied: false,
    notes:
      "Today all organizations share the single Vercel cron invocation (runRadarPipelineForAllOrganizations) - each org's run is try/caught independently (a hang or throw in one does not stop the rest) but they still execute sequentially on shared compute, not isolated.",
  },
  {
    id: "sla-observability",
    area: "OBSERVABILITY",
    description:
      "Per-organization pipeline health/duration/error-rate is queryable for SLA reporting.",
    satisfied: true,
    notes:
      "Built: the PipelineRun model (prisma/schema.prisma) plus GET /api/radar/pipeline-runs records organization/duration/status/counts/errors per run.",
  },
];
