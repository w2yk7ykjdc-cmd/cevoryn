-- CreateTable
CREATE TABLE "decision" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ruleName" TEXT NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "priorityScore" DECIMAL(14,2) NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "decision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "decision_organizationId_detectedAt_idx" ON "decision"("organizationId", "detectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "decision_organizationId_ruleName_ruleVersion_key" ON "decision"("organizationId", "ruleName", "ruleVersion");

-- AddForeignKey
ALTER TABLE "decision" ADD CONSTRAINT "decision_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
