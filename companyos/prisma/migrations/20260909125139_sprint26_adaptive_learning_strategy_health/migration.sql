-- CreateEnum
CREATE TYPE "StrategyHealthStatus" AS ENUM ('TRIAL', 'ACTIVE', 'QUARANTINED', 'RETIRED');

-- CreateTable
CREATE TABLE "strategy_health_state" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "strategyType" TEXT NOT NULL,
    "status" "StrategyHealthStatus" NOT NULL DEFAULT 'TRIAL',
    "evaluationScoreAtLastCheck" DECIMAL(6,2),
    "evaluatedTradesAtQuarantine" INTEGER,
    "reason" TEXT,
    "quarantinedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "reactivatedAt" TIMESTAMP(3),
    "reactivatedById" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "strategy_health_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "strategy_health_state_organizationId_strategyType_key" ON "strategy_health_state"("organizationId", "strategyType");

-- AddForeignKey
ALTER TABLE "strategy_health_state" ADD CONSTRAINT "strategy_health_state_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
