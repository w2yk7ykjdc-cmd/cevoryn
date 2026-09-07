/**
 * Enterprise foundation overview (Phase 2, section 16; Step 5 picked one of
 * these - Proprietary Data - to move from interface to real implementation).
 *
 * CEVORYN's enterprise roadmap needs an architecture that won't have to be
 * broken to support it later, without productizing all of it now. This
 * file is the index of what exists for that today, split into three kinds:
 *
 * REAL, RUNNING CODE (not foundations - already load-bearing):
 * - Audit: src/features/enterprise/audit/audit.service.ts - recordAuditEvent()
 *   is called from real mutation paths (entity/profile/opportunity/action/
 *   proprietary-data services) and backs a real audit_logs table.
 * - Observability/SLA: src/features/radar/pipeline-run.service.ts +
 *   the PipelineRun model - every Radar pipeline execution is recorded
 *   with organization, duration (startedAt/completedAt), counts, and
 *   errors, queryable via GET /api/radar/pipeline-runs.
 * - Worker abstraction: src/features/radar/workers/types.ts - the Worker
 *   interface future worker types (Sales/Competitive Intelligence/Finance)
 *   would implement; ResearchWorker is the one concrete instance today.
 *   "Advanced Intelligence pipelines" (section 16) has no separate type
 *   here deliberately - a future intelligence pipeline is a new Worker
 *   implementation plus PipelineRun-style observability, not a distinct
 *   concept needing its own contract.
 * - "Many entities": src/features/radar/entities/entity.service.ts + the
 *   ExternalEntity model - already org-scoped, indexed, and unbounded in
 *   count per organization. Not called out as its own foundation section
 *   below because there was nothing left to build here; Step 5's
 *   architecture review confirmed this rather than adding to it.
 *
 * PARTIALLY REAL (Step 5):
 * - Proprietary data / custom integrations: ./integrations/types.ts -
 *   `ProprietaryDataSourceKind` is now a real Prisma enum backing a real,
 *   org-scoped `ProprietaryDataRecord` table with full CRUD, search
 *   (behind the same SearchProvider seam as Memory), audit logging, and a
 *   real Brain module (src/features/brain/proprietary-data/) injecting it
 *   into the live chat system prompt. `ProprietaryDataProvider` (the
 *   *automated*-fetch side of the same file, for a future CRM/ERP/internal-
 *   API connection) remains interface-only - see that file's status
 *   comment for why.
 *
 * INTERFACE-ONLY FOUNDATIONS (no runtime implementation, not wired into
 * any live code path - each file explains why building a real one now
 * would mean faking infrastructure that doesn't exist):
 * - SSO/SAML: ./auth/sso-types.ts
 * - Advanced (team/resource-scoped) RBAC: ./rbac/advanced-rbac-types.ts
 * - Private deployment readiness: ./deployment/deployment-readiness.ts
 *   (real *data* - a checklist with honest satisfied:true/false per item)
 * - Versioned public API: ./public-api/types.ts
 * - Dedicated worker policy: ./workers/worker-policy-types.ts
 */

export {};
