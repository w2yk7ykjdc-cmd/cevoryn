-- CreateEnum
CREATE TYPE "LiveOrderStatus" AS ENUM ('INTENT', 'VALIDATING', 'SUBMITTING', 'SUBMITTED', 'PARTIALLY_FILLED', 'FILLED', 'CANCEL_REQUESTED', 'CANCELLED', 'REJECTED', 'FAILED');

-- CreateTable
CREATE TABLE "live_order" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientOrderId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" DECIMAL(28,12) NOT NULL,
    "price" DECIMAL(18,8),
    "status" "LiveOrderStatus" NOT NULL DEFAULT 'INTENT',
    "strategyType" TEXT,
    "strategySignalId" TEXT,
    "decisionSymbol" TEXT,
    "providerOrderId" TEXT,
    "rejectionReason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "filledAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_order_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "live_order_organizationId_status_idx" ON "live_order"("organizationId", "status");

-- CreateIndex
CREATE INDEX "live_order_organizationId_symbol_idx" ON "live_order"("organizationId", "symbol");

-- CreateIndex
CREATE UNIQUE INDEX "live_order_organizationId_clientOrderId_key" ON "live_order"("organizationId", "clientOrderId");

-- AddForeignKey
ALTER TABLE "live_order" ADD CONSTRAINT "live_order_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
