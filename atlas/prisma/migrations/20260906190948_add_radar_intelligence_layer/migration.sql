/*
  Warnings:

  - You are about to drop the `google_connections` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `stripe_webhook_events` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "ExternalEntityType" AS ENUM ('COMPANY');

-- CreateEnum
CREATE TYPE "WatchReason" AS ENUM ('PROSPECT', 'CUSTOMER', 'COMPETITOR', 'SUPPLIER', 'OTHER');

-- CreateEnum
CREATE TYPE "SignalSourceType" AS ENUM ('JOB_POSTING', 'PRESS_RELEASE', 'SEC_FILING');

-- CreateEnum
CREATE TYPE "SignalStatus" AS ENUM ('PENDING', 'PROCESSED', 'IGNORED', 'FAILED');

-- CreateEnum
CREATE TYPE "ExternalEventType" AS ENUM ('HIRING_ACCELERATION', 'HIRING_DECLINE', 'EXPANSION', 'NEW_FACILITY', 'LEADERSHIP_CHANGE', 'FUNDING', 'ACQUISITION', 'PRODUCT_LAUNCH', 'PARTNERSHIP', 'PROCUREMENT', 'MARKET_ENTRY', 'REGULATORY_CHANGE');

-- CreateEnum
CREATE TYPE "ExternalEventStatus" AS ENUM ('NEW', 'ANALYZED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "OpportunityPolarity" AS ENUM ('OPPORTUNITY', 'THREAT');

-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('NEW', 'REVIEWING', 'QUALIFIED', 'ACTED_ON', 'WON', 'LOST', 'DISMISSED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('NEW_OPPORTUNITY', 'HIGH_PRIORITY_EVENT', 'THREAT_DETECTED', 'ACTION_REQUIRED', 'ACTION_COMPLETED', 'RESEARCH_COMPLETED', 'SYSTEM_ALERT');

-- CreateEnum
CREATE TYPE "ResearchTaskStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ActionExecutionChannel" AS ENUM ('MAILTO', 'CLIPBOARD', 'GOOGLE_EMAIL_DRAFT', 'GOOGLE_CALENDAR_EVENT', 'RESEARCH_WORKER');

-- CreateEnum
CREATE TYPE "ActionExecutionStatus" AS ENUM ('STARTED', 'COMPLETED', 'FAILED');

-- DropForeignKey
ALTER TABLE "google_connections" DROP CONSTRAINT "google_connections_organization_id_fkey";

-- AlterTable
ALTER TABLE "outcome_evaluations" ADD COLUMN     "opportunity_id" TEXT,
ALTER COLUMN "decision_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "prepared_actions" ADD COLUMN     "source_opportunity_id" TEXT;

-- AlterTable
ALTER TABLE "subscriptions" ALTER COLUMN "updated_at" DROP DEFAULT;

-- DropTable
DROP TABLE "google_connections";

-- DropTable
DROP TABLE "stripe_webhook_events";

-- CreateTable
CREATE TABLE "company_profiles" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "industry" TEXT,
    "products" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "services" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "target_markets" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "target_customers" TEXT NOT NULL DEFAULT '',
    "ideal_customer_profile" TEXT NOT NULL DEFAULT '',
    "geographies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "competitors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "suppliers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "business_model" TEXT NOT NULL DEFAULT '',
    "average_deal_size" DOUBLE PRECISION,
    "strategic_goals" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "strategic_priorities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "constraints" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_entities" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "type" "ExternalEntityType" NOT NULL DEFAULT 'COMPANY',
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "domain" TEXT,
    "industry" TEXT,
    "country" TEXT,
    "watch_reason" "WatchReason" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "added_by_user_id" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_signals" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "external_entity_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_type" "SignalSourceType" NOT NULL,
    "source_url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "raw_content" TEXT NOT NULL,
    "published_at" TIMESTAMP(3),
    "observed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hash" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "status" "SignalStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "external_entity_id" TEXT NOT NULL,
    "type" "ExternalEventType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "source" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "status" "ExternalEventStatus" NOT NULL DEFAULT 'NEW',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunities" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "external_entity_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "polarity" "OpportunityPolarity" NOT NULL DEFAULT 'OPPORTUNITY',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "estimated_value_min" DOUBLE PRECISION,
    "estimated_value_max" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "probability" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "strategic_fit" DOUBLE PRECISION NOT NULL,
    "time_horizon" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "score" DOUBLE PRECISION NOT NULL,
    "score_breakdown" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 5,
    "status" "OpportunityStatus" NOT NULL DEFAULT 'NEW',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "read_at" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_tasks" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "opportunity_id" TEXT NOT NULL,
    "requested_by_user_id" TEXT NOT NULL,
    "status" "ResearchTaskStatus" NOT NULL DEFAULT 'PENDING',
    "brief" TEXT,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "research_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_executions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "prepared_action_id" TEXT NOT NULL,
    "channel" "ActionExecutionChannel" NOT NULL,
    "status" "ActionExecutionStatus" NOT NULL DEFAULT 'STARTED',
    "result" JSONB,
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "action_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_profiles_organization_id_key" ON "company_profiles"("organization_id");

-- CreateIndex
CREATE INDEX "external_entities_organization_id_is_active_idx" ON "external_entities"("organization_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "external_entities_organization_id_normalized_name_key" ON "external_entities"("organization_id", "normalized_name");

-- CreateIndex
CREATE INDEX "external_signals_organization_id_status_idx" ON "external_signals"("organization_id", "status");

-- CreateIndex
CREATE INDEX "external_signals_external_entity_id_observed_at_idx" ON "external_signals"("external_entity_id", "observed_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "external_signals_organization_id_hash_key" ON "external_signals"("organization_id", "hash");

-- CreateIndex
CREATE INDEX "external_events_organization_id_status_idx" ON "external_events"("organization_id", "status");

-- CreateIndex
CREATE INDEX "external_events_external_entity_id_occurred_at_idx" ON "external_events"("external_entity_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "opportunities_organization_id_status_idx" ON "opportunities"("organization_id", "status");

-- CreateIndex
CREATE INDEX "opportunities_organization_id_polarity_created_at_idx" ON "opportunities"("organization_id", "polarity", "created_at" DESC);

-- CreateIndex
CREATE INDEX "opportunities_external_entity_id_idx" ON "opportunities"("external_entity_id");

-- CreateIndex
CREATE INDEX "notifications_organization_id_user_id_read_at_idx" ON "notifications"("organization_id", "user_id", "read_at");

-- CreateIndex
CREATE INDEX "notifications_organization_id_created_at_idx" ON "notifications"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "research_tasks_organization_id_status_idx" ON "research_tasks"("organization_id", "status");

-- CreateIndex
CREATE INDEX "research_tasks_opportunity_id_idx" ON "research_tasks"("opportunity_id");

-- CreateIndex
CREATE INDEX "action_executions_organization_id_prepared_action_id_idx" ON "action_executions"("organization_id", "prepared_action_id");

-- CreateIndex
CREATE INDEX "outcome_evaluations_opportunity_id_idx" ON "outcome_evaluations"("opportunity_id");

-- CreateIndex
CREATE INDEX "prepared_actions_source_opportunity_id_idx" ON "prepared_actions"("source_opportunity_id");

-- AddForeignKey
ALTER TABLE "prepared_actions" ADD CONSTRAINT "prepared_actions_source_opportunity_id_fkey" FOREIGN KEY ("source_opportunity_id") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_evaluations" ADD CONSTRAINT "outcome_evaluations_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_profiles" ADD CONSTRAINT "company_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_entities" ADD CONSTRAINT "external_entities_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_signals" ADD CONSTRAINT "external_signals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_signals" ADD CONSTRAINT "external_signals_external_entity_id_fkey" FOREIGN KEY ("external_entity_id") REFERENCES "external_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_events" ADD CONSTRAINT "external_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_events" ADD CONSTRAINT "external_events_external_entity_id_fkey" FOREIGN KEY ("external_entity_id") REFERENCES "external_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_external_entity_id_fkey" FOREIGN KEY ("external_entity_id") REFERENCES "external_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "external_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_tasks" ADD CONSTRAINT "research_tasks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_tasks" ADD CONSTRAINT "research_tasks_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_executions" ADD CONSTRAINT "action_executions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_executions" ADD CONSTRAINT "action_executions_prepared_action_id_fkey" FOREIGN KEY ("prepared_action_id") REFERENCES "prepared_actions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
