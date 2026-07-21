-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');
CREATE TYPE "InviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');
CREATE TYPE "MemoryCategory" AS ENUM ('DECISION', 'PREFERENCE', 'TEAM_DYNAMIC', 'PROJECT_STATUS', 'PROCESS', 'GOAL', 'FACT');
CREATE TYPE "MemorySource" AS ENUM ('CONVERSATION', 'MANUAL', 'INSIGHT');
CREATE TYPE "InsightCategory" AS ENUM ('STRATEGIC', 'OPERATIONAL', 'TEAM', 'FINANCIAL', 'RISK');
CREATE TYPE "InsightSeverity" AS ENUM ('INFO', 'SUGGESTION', 'WARNING', 'CRITICAL');
CREATE TYPE "InsightStatus" AS ENUM ('NEW', 'ACKNOWLEDGED', 'ACTED_ON', 'DISMISSED');
CREATE TYPE "PulsePeriod" AS ENUM ('DAILY', 'WEEKLY');
CREATE TYPE "BriefType" AS ENUM ('DAILY', 'WEEKLY');
CREATE TYPE "ActionType" AS ENUM ('EMAIL_DRAFT', 'TASK', 'CALENDAR_PROPOSAL', 'FOLLOW_UP');
CREATE TYPE "ActionStatus" AS ENUM ('PENDING', 'APPROVED', 'DISMISSED');
CREATE TYPE "DecisionStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'REJECTED', 'IGNORED', 'EXECUTED', 'COMPLETED', 'SUCCESSFUL', 'FAILED', 'UNKNOWN');
CREATE TYPE "TimelineEventType" AS ENUM ('PROBLEM_DETECTED', 'CANVAS_GENERATED', 'RECOMMENDATION_MADE', 'USER_ACCEPTED', 'USER_REJECTED', 'USER_IGNORED', 'EXECUTION_STARTED', 'OUTCOME_RECORDED', 'OUTCOME_EVALUATED', 'LEARNING_EXTRACTED', 'FOLLOW_UP_DUE');
CREATE TYPE "OutcomeResult" AS ENUM ('SUCCESS', 'FAILURE', 'PARTIAL_SUCCESS', 'NO_OUTCOME_YET');

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateTable
CREATE TABLE "members" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'MEMBER',
    "display_name" TEXT NOT NULL,
    "avatar_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "members_user_id_idx" ON "members"("user_id");
CREATE INDEX "members_organization_id_idx" ON "members"("organization_id");
CREATE UNIQUE INDEX "members_user_id_organization_id_key" ON "members"("user_id", "organization_id");

-- CreateTable
CREATE TABLE "invites" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'MEMBER',
    "status" "InviteStatus" NOT NULL DEFAULT 'PENDING',
    "invited_by" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "invites_token_key" ON "invites"("token");
CREATE INDEX "invites_email_idx" ON "invites"("email");
CREATE INDEX "invites_organization_id_idx" ON "invites"("organization_id");
CREATE INDEX "invites_token_idx" ON "invites"("token");

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'New conversation',
    "organization_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "conversations_organization_id_created_by_id_idx" ON "conversations"("organization_id", "created_by_id");
CREATE INDEX "conversations_organization_id_updated_at_idx" ON "conversations"("organization_id", "updated_at" DESC);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "model" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- CreateTable
CREATE TABLE "usage_records" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "total_tokens" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "usage_records_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "usage_records_organization_id_created_at_idx" ON "usage_records"("organization_id", "created_at");
CREATE INDEX "usage_records_user_id_created_at_idx" ON "usage_records"("user_id", "created_at");

-- CreateTable
CREATE TABLE "memories" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "category" "MemoryCategory" NOT NULL,
    "content" TEXT NOT NULL,
    "source" "MemorySource" NOT NULL DEFAULT 'MANUAL',
    "source_id" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "memories_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "memories_organization_id_is_active_idx" ON "memories"("organization_id", "is_active");
CREATE INDEX "memories_organization_id_category_idx" ON "memories"("organization_id", "category");

-- CreateTable
CREATE TABLE "insights" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "category" "InsightCategory" NOT NULL,
    "severity" "InsightSeverity" NOT NULL DEFAULT 'INFO',
    "status" "InsightStatus" NOT NULL DEFAULT 'NEW',
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL,
    "impact" TEXT NOT NULL DEFAULT '',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "reasoning" TEXT NOT NULL DEFAULT '',
    "recommended_action" TEXT NOT NULL DEFAULT '',
    "priority" INTEGER NOT NULL DEFAULT 5,
    "action_items" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "insights_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "insights_organization_id_status_idx" ON "insights"("organization_id", "status");
CREATE INDEX "insights_organization_id_created_at_idx" ON "insights"("organization_id", "created_at" DESC);

-- CreateTable
CREATE TABLE "pulse_snapshots" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "period" "PulsePeriod" NOT NULL,
    "metrics" JSONB NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pulse_snapshots_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pulse_snapshots_organization_id_period_period_start_key" ON "pulse_snapshots"("organization_id", "period", "period_start");
CREATE INDEX "pulse_snapshots_organization_id_period_created_at_idx" ON "pulse_snapshots"("organization_id", "period", "created_at" DESC);

-- CreateTable
CREATE TABLE "briefs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "type" "BriefType" NOT NULL,
    "title" TEXT NOT NULL,
    "sections" JSONB NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "briefs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "briefs_organization_id_type_created_at_idx" ON "briefs"("organization_id", "type", "created_at" DESC);

-- CreateTable
CREATE TABLE "prepared_actions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "type" "ActionType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "status" "ActionStatus" NOT NULL DEFAULT 'PENDING',
    "source_insight_id" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "reasoning" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "prepared_actions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "prepared_actions_organization_id_status_idx" ON "prepared_actions"("organization_id", "status");
CREATE INDEX "prepared_actions_organization_id_created_at_idx" ON "prepared_actions"("organization_id", "created_at" DESC);

-- CreateTable
CREATE TABLE "decisions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "status" "DecisionStatus" NOT NULL DEFAULT 'PROPOSED',
    "canvas" JSONB NOT NULL,
    "priority_score" DOUBLE PRECISION NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "outcome" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "decisions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "decisions_organization_id_status_idx" ON "decisions"("organization_id", "status");
CREATE INDEX "decisions_organization_id_created_at_idx" ON "decisions"("organization_id", "created_at" DESC);

-- CreateTable
CREATE TABLE "decision_timeline_events" (
    "id" TEXT NOT NULL,
    "decision_id" TEXT NOT NULL,
    "type" "TimelineEventType" NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "decision_timeline_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "decision_timeline_events_decision_id_created_at_idx" ON "decision_timeline_events"("decision_id", "created_at");

-- CreateTable
CREATE TABLE "outcome_evaluations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "decision_id" TEXT NOT NULL,
    "result" "OutcomeResult" NOT NULL,
    "outcome_score" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "explanation" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "outcome_evaluations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "outcome_evaluations_organization_id_created_at_idx" ON "outcome_evaluations"("organization_id", "created_at" DESC);
CREATE INDEX "outcome_evaluations_decision_id_idx" ON "outcome_evaluations"("decision_id");

-- CreateTable
CREATE TABLE "learning_patterns" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "pattern_type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "frequency" INTEGER NOT NULL DEFAULT 1,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "learning_patterns_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "learning_patterns_organization_id_pattern_type_idx" ON "learning_patterns"("organization_id", "pattern_type");
CREATE INDEX "learning_patterns_organization_id_category_idx" ON "learning_patterns"("organization_id", "category");

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invites" ADD CONSTRAINT "invites_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memories" ADD CONSTRAINT "memories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "insights" ADD CONSTRAINT "insights_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pulse_snapshots" ADD CONSTRAINT "pulse_snapshots_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "prepared_actions" ADD CONSTRAINT "prepared_actions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "decision_timeline_events" ADD CONSTRAINT "decision_timeline_events_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "outcome_evaluations" ADD CONSTRAINT "outcome_evaluations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "learning_patterns" ADD CONSTRAINT "learning_patterns_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
