-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('planning', 'running', 'waiting_approval', 'completed', 'failed', 'rejected');

-- CreateEnum
CREATE TYPE "AgentStepStatus" AS ENUM ('pending', 'running', 'succeeded', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "AgentApprovalStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "agent_run" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "plan" JSONB NOT NULL,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'planning',
    "resultSummary" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "agent_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_step" (
    "id" TEXT NOT NULL,
    "agentRunId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "toolName" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "status" "AgentStepStatus" NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "approvalId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_step_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_approval" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentRunId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "AgentApprovalStatus" NOT NULL DEFAULT 'pending',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_approval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_run_organizationId_createdAt_idx" ON "agent_run"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "agent_run_organizationId_status_idx" ON "agent_run"("organizationId", "status");

-- CreateIndex
CREATE INDEX "agent_run_conversationId_idx" ON "agent_run"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_step_approvalId_key" ON "agent_step"("approvalId");

-- CreateIndex
CREATE INDEX "agent_step_agentRunId_idx" ON "agent_step"("agentRunId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_step_agentRunId_stepIndex_key" ON "agent_step"("agentRunId", "stepIndex");

-- CreateIndex
CREATE INDEX "agent_approval_organizationId_status_idx" ON "agent_approval"("organizationId", "status");

-- CreateIndex
CREATE INDEX "agent_approval_agentRunId_idx" ON "agent_approval"("agentRunId");

-- AddForeignKey
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_step" ADD CONSTRAINT "agent_step_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "agent_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_step" ADD CONSTRAINT "agent_step_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "agent_approval"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_approval" ADD CONSTRAINT "agent_approval_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_approval" ADD CONSTRAINT "agent_approval_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "agent_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_approval" ADD CONSTRAINT "agent_approval_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
