-- Hand-written, not the raw `prisma migrate dev` diff: Prisma's own diff
-- for the ResearchTask -> WorkerTask rename is a DROP TABLE + CREATE TABLE
-- (it does not detect model renames from the schema alone), which would
-- silently discard any research_tasks rows already written in production.
-- This version performs the equivalent end state via ALTER ... RENAME
-- instead, which preserves existing rows. Verified to produce an
-- identical resulting schema to the auto-generated version (checked with
-- `prisma migrate diff` against a database migrated with each).

-- CreateEnum
CREATE TYPE "WorkerType" AS ENUM ('RESEARCH');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'SYSTEM', 'CRON', 'AI_WORKER');

-- CreateEnum
CREATE TYPE "PipelineRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- RenameEnum (was ResearchTaskStatus - values are unchanged)
ALTER TYPE "ResearchTaskStatus" RENAME TO "WorkerTaskStatus";

-- AlterTable
ALTER TABLE "company_profiles" ADD COLUMN     "company_size" TEXT,
ADD COLUMN     "custom_context" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "excluded_opportunities" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "growth_objectives" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "known_customers" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "preferred_currency" TEXT NOT NULL DEFAULT 'EUR',
ADD COLUMN     "preferred_opportunities" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "revenue_range" TEXT;

-- AlterTable
ALTER TABLE "external_entities" ADD COLUMN     "is_paused" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notes" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- RenameTable (was research_tasks - existing rows, if any, are preserved)
ALTER TABLE "research_tasks" RENAME TO "worker_tasks";

-- AlterTable: add the new discriminator column, defaulting existing rows
-- (all of which were Research-worker tasks) to 'RESEARCH'.
ALTER TABLE "worker_tasks" ADD COLUMN "worker_type" "WorkerType" NOT NULL DEFAULT 'RESEARCH';

-- RenameConstraint
ALTER TABLE "worker_tasks" RENAME CONSTRAINT "research_tasks_pkey" TO "worker_tasks_pkey";
ALTER TABLE "worker_tasks" RENAME CONSTRAINT "research_tasks_organization_id_fkey" TO "worker_tasks_organization_id_fkey";
ALTER TABLE "worker_tasks" RENAME CONSTRAINT "research_tasks_opportunity_id_fkey" TO "worker_tasks_opportunity_id_fkey";

-- RenameIndex
ALTER INDEX "research_tasks_organization_id_status_idx" RENAME TO "worker_tasks_organization_id_status_idx";
ALTER INDEX "research_tasks_opportunity_id_idx" RENAME TO "worker_tasks_opportunity_id_idx";

-- CreateIndex
CREATE INDEX "worker_tasks_organization_id_worker_type_idx" ON "worker_tasks"("organization_id", "worker_type");

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "actor_type" "AuditActorType" NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_runs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "status" "PipelineRunStatus" NOT NULL DEFAULT 'RUNNING',
    "signals_ingested" INTEGER NOT NULL DEFAULT 0,
    "events_created" INTEGER NOT NULL DEFAULT 0,
    "opportunities_created" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "pipeline_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_created_at_idx" ON "audit_logs"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_resource_type_resource_id_idx" ON "audit_logs"("organization_id", "resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "pipeline_runs_organization_id_started_at_idx" ON "pipeline_runs"("organization_id", "started_at" DESC);

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
