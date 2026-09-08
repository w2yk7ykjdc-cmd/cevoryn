-- CreateEnum
CREATE TYPE "SignalSourceType" AS ENUM ('domain_event', 'scanner');

-- CreateEnum
CREATE TYPE "SignalSeverity" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "SignalStatus" AS ENUM ('active', 'resolved', 'expired');

-- CreateTable
CREATE TABLE "company_signal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sourceType" "SignalSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "severity" "SignalSeverity" NOT NULL,
    "confidence" INTEGER NOT NULL,
    "relatedEntityType" TEXT,
    "relatedEntityId" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ruleName" TEXT NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "status" "SignalStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_signal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "company_signal_organizationId_detectedAt_idx" ON "company_signal"("organizationId", "detectedAt");

-- CreateIndex
CREATE INDEX "company_signal_organizationId_relatedEntityType_relatedEnti_idx" ON "company_signal"("organizationId", "relatedEntityType", "relatedEntityId");

-- CreateIndex
CREATE INDEX "company_signal_organizationId_status_idx" ON "company_signal"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "company_signal_organizationId_sourceType_ruleName_ruleVersi_key" ON "company_signal"("organizationId", "sourceType", "ruleName", "ruleVersion", "sourceId");

-- AddForeignKey
ALTER TABLE "company_signal" ADD CONSTRAINT "company_signal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
