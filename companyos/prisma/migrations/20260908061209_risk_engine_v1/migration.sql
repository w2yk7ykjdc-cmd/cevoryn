-- CreateEnum
CREATE TYPE "RiskStatus" AS ENUM ('open', 'resolved', 'dismissed');

-- CreateTable
CREATE TABLE "risk" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "SignalSeverity" NOT NULL,
    "confidence" INTEGER NOT NULL,
    "potentialLoss" DECIMAL(14,2) NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "explanation" TEXT NOT NULL,
    "relatedEntityType" TEXT,
    "relatedEntityId" TEXT,
    "sourceSignalId" TEXT,
    "status" "RiskStatus" NOT NULL DEFAULT 'open',
    "ruleName" TEXT NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "risk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "risk_organizationId_status_idx" ON "risk"("organizationId", "status");

-- CreateIndex
CREATE INDEX "risk_organizationId_detectedAt_idx" ON "risk"("organizationId", "detectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "risk_organizationId_ruleName_ruleVersion_relatedEntityType__key" ON "risk"("organizationId", "ruleName", "ruleVersion", "relatedEntityType", "relatedEntityId");

-- AddForeignKey
ALTER TABLE "risk" ADD CONSTRAINT "risk_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
