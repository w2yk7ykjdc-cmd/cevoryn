-- CreateEnum
CREATE TYPE "AutonomyLevel" AS ENUM ('L0', 'L1', 'L2', 'L3', 'L4', 'L5');

-- CreateEnum
CREATE TYPE "AutonomousActionOutcome" AS ENUM ('executed', 'blocked_policy', 'blocked_limit', 'blocked_kill_switch', 'blocked_not_allowlisted', 'requires_approval');

-- CreateEnum
CREATE TYPE "AutonomousActionTrigger" AS ENUM ('interactive_chat', 'agent_run', 'scheduler', 'event');

-- CreateTable
CREATE TABLE "autonomy_policy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "level" "AutonomyLevel" NOT NULL DEFAULT 'L2',
    "dailyActionLimit" INTEGER NOT NULL DEFAULT 0,
    "dailyRiskLimit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "perActionRiskLimit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "killSwitchEngaged" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "autonomy_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "autonomy_policy_version" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "level" "AutonomyLevel" NOT NULL,
    "dailyActionLimit" INTEGER NOT NULL,
    "dailyRiskLimit" DECIMAL(14,2) NOT NULL,
    "perActionRiskLimit" DECIMAL(14,2) NOT NULL,
    "killSwitchEngaged" BOOLEAN NOT NULL,
    "changedById" TEXT NOT NULL,
    "changeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "autonomy_policy_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "autonomy_allowlist_entry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "minLevelRequired" "AutonomyLevel" NOT NULL,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "autonomy_allowlist_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "autonomous_action_log" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "level" "AutonomyLevel" NOT NULL,
    "outcome" "AutonomousActionOutcome" NOT NULL,
    "policyVersionId" TEXT,
    "allowlistEntryId" TEXT,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "errorMessage" TEXT,
    "dailyActionCountAtDecision" INTEGER NOT NULL,
    "dailyRiskUsedAtDecision" DECIMAL(14,2) NOT NULL,
    "actionRiskValue" DECIMAL(14,2),
    "toolInvocationId" TEXT,
    "triggeredBy" "AutonomousActionTrigger" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "autonomous_action_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "autonomy_policy_organizationId_domain_key" ON "autonomy_policy"("organizationId", "domain");

-- CreateIndex
CREATE INDEX "autonomy_policy_version_organizationId_domain_createdAt_idx" ON "autonomy_policy_version"("organizationId", "domain", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "autonomy_policy_version_organizationId_domain_versionNumber_key" ON "autonomy_policy_version"("organizationId", "domain", "versionNumber");

-- CreateIndex
CREATE INDEX "autonomy_allowlist_entry_organizationId_domain_idx" ON "autonomy_allowlist_entry"("organizationId", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "autonomy_allowlist_entry_organizationId_domain_toolName_key" ON "autonomy_allowlist_entry"("organizationId", "domain", "toolName");

-- CreateIndex
CREATE INDEX "autonomous_action_log_organizationId_domain_createdAt_idx" ON "autonomous_action_log"("organizationId", "domain", "createdAt");

-- CreateIndex
CREATE INDEX "autonomous_action_log_organizationId_outcome_idx" ON "autonomous_action_log"("organizationId", "outcome");

-- AddForeignKey
ALTER TABLE "autonomy_policy" ADD CONSTRAINT "autonomy_policy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autonomy_policy_version" ADD CONSTRAINT "autonomy_policy_version_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autonomy_allowlist_entry" ADD CONSTRAINT "autonomy_allowlist_entry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autonomous_action_log" ADD CONSTRAINT "autonomous_action_log_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
