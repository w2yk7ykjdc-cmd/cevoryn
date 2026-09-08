-- CreateEnum
CREATE TYPE "PaperPositionDirection" AS ENUM ('LONG', 'SHORT');

-- CreateEnum
CREATE TYPE "PaperPositionMode" AS ENUM ('SPOT', 'PERPETUAL_SIMULATION');

-- CreateEnum
CREATE TYPE "PaperPositionStatus" AS ENUM ('PENDING', 'OPEN', 'CLOSED', 'STOPPED', 'TAKE_PROFIT', 'LIQUIDATED', 'INVALIDATED');

-- CreateTable
CREATE TABLE "paper_account" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "startingEquity" DECIMAL(18,8) NOT NULL,
    "currentEquity" DECIMAL(18,8) NOT NULL,
    "peakEquity" DECIMAL(18,8) NOT NULL,
    "usedMargin" DECIMAL(18,8) NOT NULL,
    "unrealizedPnl" DECIMAL(18,8) NOT NULL,
    "realizedPnl" DECIMAL(18,8) NOT NULL,
    "totalFees" DECIMAL(18,8) NOT NULL,
    "totalFunding" DECIMAL(18,8) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "paper_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paper_position" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "direction" "PaperPositionDirection" NOT NULL,
    "mode" "PaperPositionMode" NOT NULL,
    "status" "PaperPositionStatus" NOT NULL DEFAULT 'OPEN',
    "strategyType" TEXT NOT NULL,
    "strategySignalId" TEXT,
    "regime" TEXT,
    "leverage" INTEGER NOT NULL,
    "entryPrice" DECIMAL(18,8) NOT NULL,
    "currentPrice" DECIMAL(18,8) NOT NULL,
    "exitPrice" DECIMAL(18,8),
    "quantity" DECIMAL(28,12) NOT NULL,
    "notional" DECIMAL(18,8) NOT NULL,
    "initialMargin" DECIMAL(18,8) NOT NULL,
    "stopLossPrice" DECIMAL(18,8) NOT NULL,
    "takeProfitPrice" DECIMAL(18,8) NOT NULL,
    "liquidationPrice" DECIMAL(18,8),
    "riskUnit" DECIMAL(18,8) NOT NULL,
    "unrealizedPnl" DECIMAL(18,8) NOT NULL,
    "realizedPnl" DECIMAL(18,8),
    "feesPaid" DECIMAL(18,8) NOT NULL,
    "fundingPaid" DECIMAL(18,8) NOT NULL,
    "maxFavorableExcursion" DECIMAL(18,8) NOT NULL,
    "maxAdverseExcursion" DECIMAL(18,8) NOT NULL,
    "lastFundingAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "paper_position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paper_trade" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "direction" "PaperPositionDirection" NOT NULL,
    "mode" "PaperPositionMode" NOT NULL,
    "strategyType" TEXT NOT NULL,
    "strategySignalId" TEXT,
    "regime" TEXT,
    "leverage" INTEGER NOT NULL,
    "entryPrice" DECIMAL(18,8) NOT NULL,
    "exitPrice" DECIMAL(18,8) NOT NULL,
    "quantity" DECIMAL(28,12) NOT NULL,
    "notional" DECIMAL(18,8) NOT NULL,
    "initialMargin" DECIMAL(18,8) NOT NULL,
    "grossPnl" DECIMAL(18,8) NOT NULL,
    "feesPaid" DECIMAL(18,8) NOT NULL,
    "fundingPaid" DECIMAL(18,8) NOT NULL,
    "netPnl" DECIMAL(18,8) NOT NULL,
    "returnPct" DECIMAL(10,4) NOT NULL,
    "maxFavorableExcursion" DECIMAL(18,8) NOT NULL,
    "maxAdverseExcursion" DECIMAL(18,8) NOT NULL,
    "closeReason" "PaperPositionStatus" NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paper_trade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "paper_account_organizationId_key" ON "paper_account"("organizationId");

-- CreateIndex
CREATE INDEX "paper_position_organizationId_symbol_status_idx" ON "paper_position"("organizationId", "symbol", "status");

-- CreateIndex
CREATE INDEX "paper_position_organizationId_status_idx" ON "paper_position"("organizationId", "status");

-- CreateIndex
CREATE INDEX "paper_position_organizationId_closedAt_idx" ON "paper_position"("organizationId", "closedAt");

-- CreateIndex
CREATE UNIQUE INDEX "paper_trade_positionId_key" ON "paper_trade"("positionId");

-- CreateIndex
CREATE INDEX "paper_trade_organizationId_symbol_idx" ON "paper_trade"("organizationId", "symbol");

-- CreateIndex
CREATE INDEX "paper_trade_organizationId_closedAt_idx" ON "paper_trade"("organizationId", "closedAt");

-- CreateIndex
CREATE INDEX "paper_trade_organizationId_strategyType_idx" ON "paper_trade"("organizationId", "strategyType");

-- AddForeignKey
ALTER TABLE "paper_account" ADD CONSTRAINT "paper_account_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_position" ADD CONSTRAINT "paper_position_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_trade" ADD CONSTRAINT "paper_trade_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
