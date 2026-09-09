-- CreateEnum
CREATE TYPE "BacktestRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "backtest_run" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestedById" TEXT,
    "label" TEXT NOT NULL,
    "status" "BacktestRunStatus" NOT NULL DEFAULT 'PENDING',
    "config" JSONB NOT NULL,
    "result" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "backtest_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "backtest_run_organizationId_createdAt_idx" ON "backtest_run"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "backtest_run_organizationId_status_idx" ON "backtest_run"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "backtest_run" ADD CONSTRAINT "backtest_run_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
