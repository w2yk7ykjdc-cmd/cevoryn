-- CreateEnum
CREATE TYPE "OutcomeType" AS ENUM ('success', 'failure', 'neutral', 'expired', 'reversed', 'unknown');

-- CreateEnum
CREATE TYPE "OutcomeEvaluationStatus" AS ENUM ('pending', 'evaluated', 'insufficient_evidence');

-- CreateEnum
CREATE TYPE "OutcomeSource" AS ENUM ('system', 'human');

-- CreateTable
CREATE TABLE "outcome" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "relatedEntityType" TEXT NOT NULL,
    "relatedEntityId" TEXT NOT NULL,
    "autonomousActionLogId" TEXT,
    "decisionId" TEXT,
    "signalId" TEXT,
    "ruleName" TEXT NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "evaluationStatus" "OutcomeEvaluationStatus" NOT NULL DEFAULT 'pending',
    "outcomeType" "OutcomeType",
    "source" "OutcomeSource",
    "confidence" INTEGER,
    "value" DECIMAL(14,2),
    "currency" TEXT,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "observationDueAt" TIMESTAMP(3),
    "observedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_record" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "outcomeId" TEXT NOT NULL,
    "decisionId" TEXT,
    "autonomousActionLogId" TEXT,
    "relatedEntityType" TEXT NOT NULL,
    "relatedEntityId" TEXT NOT NULL,
    "ruleName" TEXT NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "outcomeType" "OutcomeType" NOT NULL,
    "expectedValue" DECIMAL(14,2),
    "observedValue" DECIMAL(14,2),
    "errorValue" DECIMAL(14,2),
    "evaluationConfidence" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_record_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outcome_organizationId_evaluationStatus_idx" ON "outcome"("organizationId", "evaluationStatus");

-- CreateIndex
CREATE INDEX "outcome_organizationId_relatedEntityType_relatedEntityId_idx" ON "outcome"("organizationId", "relatedEntityType", "relatedEntityId");

-- CreateIndex
CREATE INDEX "outcome_organizationId_createdAt_idx" ON "outcome"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "outcome_organizationId_ruleName_ruleVersion_relatedEntityTy_key" ON "outcome"("organizationId", "ruleName", "ruleVersion", "relatedEntityType", "relatedEntityId");

-- CreateIndex
CREATE UNIQUE INDEX "learning_record_outcomeId_key" ON "learning_record"("outcomeId");

-- CreateIndex
CREATE INDEX "learning_record_organizationId_ruleName_ruleVersion_idx" ON "learning_record"("organizationId", "ruleName", "ruleVersion");

-- CreateIndex
CREATE INDEX "learning_record_organizationId_createdAt_idx" ON "learning_record"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "outcome" ADD CONSTRAINT "outcome_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_record" ADD CONSTRAINT "learning_record_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
