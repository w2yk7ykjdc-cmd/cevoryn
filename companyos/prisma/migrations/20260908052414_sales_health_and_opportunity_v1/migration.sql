-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('new', 'reviewed', 'acted', 'dismissed', 'expired');

-- CreateEnum
CREATE TYPE "OpportunityEffort" AS ENUM ('low', 'medium', 'high');

-- CreateTable
CREATE TABLE "company_health_snapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "salesHealthScore" INTEGER NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "ruleVersion" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_health_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "confidence" INTEGER NOT NULL,
    "potentialImpact" DECIMAL(14,2) NOT NULL,
    "effort" "OpportunityEffort" NOT NULL,
    "urgency" "SignalSeverity" NOT NULL,
    "risk" "SignalSeverity" NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "explanation" TEXT NOT NULL,
    "relatedEntityType" TEXT,
    "relatedEntityId" TEXT,
    "sourceSignalId" TEXT,
    "status" "OpportunityStatus" NOT NULL DEFAULT 'new',
    "ruleName" TEXT NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "company_health_snapshot_organizationId_computedAt_idx" ON "company_health_snapshot"("organizationId", "computedAt");

-- CreateIndex
CREATE INDEX "opportunity_organizationId_status_idx" ON "opportunity"("organizationId", "status");

-- CreateIndex
CREATE INDEX "opportunity_organizationId_detectedAt_idx" ON "opportunity"("organizationId", "detectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "opportunity_organizationId_ruleName_ruleVersion_relatedEnti_key" ON "opportunity"("organizationId", "ruleName", "ruleVersion", "relatedEntityType", "relatedEntityId");

-- AddForeignKey
ALTER TABLE "company_health_snapshot" ADD CONSTRAINT "company_health_snapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
