-- AlterTable
ALTER TABLE "live_order" ADD COLUMN     "averageFillPrice" DECIMAL(18,8),
ADD COLUMN     "filledQuantity" DECIMAL(28,12) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "organization_risk_policy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "maxLeverage" DECIMAL(6,2) NOT NULL,
    "maxOrderNotionalPct" DECIMAL(6,4) NOT NULL,
    "maxTotalExposureMultiple" DECIMAL(6,4) NOT NULL,
    "maxSimultaneousPositions" INTEGER NOT NULL,
    "maxSymbolExposurePct" DECIMAL(6,4) NOT NULL,
    "maxStrategyExposurePct" DECIMAL(6,4) NOT NULL,
    "maxDailyLossPct" DECIMAL(6,4) NOT NULL,
    "maxConsecutiveLosses" INTEGER NOT NULL,
    "maxPortfolioDrawdownPct" DECIMAL(6,4) NOT NULL,
    "emergencyStopThresholdPct" DECIMAL(6,4) NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_risk_policy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organization_risk_policy_organizationId_key" ON "organization_risk_policy"("organizationId");

-- AddForeignKey
ALTER TABLE "organization_risk_policy" ADD CONSTRAINT "organization_risk_policy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
