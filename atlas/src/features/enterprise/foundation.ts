/**
 * Enterprise foundation overview (Phase 2, section 16).
 *
 * CEVORYN's enterprise roadmap needs an architecture that won't have to be
 * broken to support it later, without productizing all of it now. This
 * file is the index of what exists for that today, split into two kinds:
 *
 * REAL, RUNNING CODE (not foundations - already load-bearing):
 * - Audit: src/features/enterprise/audit/audit.service.ts - recordAuditEvent()
 *   is called from real mutation paths (entity/profile/opportunity/action
 *   services) and backs a real audit_logs table.
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
 *
 * INTERFACE-ONLY FOUNDATIONS (no runtime implementation, not wired into
 * any live code path - each file explains why building a real one now
 * would mean faking infrastructure that doesn't exist):
 * - Proprietary data / custom integrations: ./integrations/types.ts
 * - SSO/SAML: ./auth/sso-types.ts
 * - Advanced (team/resource-scoped) RBAC: ./rbac/advanced-rbac-types.ts
 * - Private deployment readiness: ./deployment/deployment-readiness.ts
 *   (real *data* - a checklist with honest satisfied:true/false per item)
 * - Versioned public API: ./public-api/types.ts
 * - Dedicated worker policy: ./workers/worker-policy-types.ts
 */

export {};
