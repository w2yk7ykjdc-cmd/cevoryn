-- CreateTable
CREATE TABLE "organization_execution_autonomy_policy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "enabledById" TEXT,
    "enabledAt" TIMESTAMP(3),
    "disabledById" TEXT,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_execution_autonomy_policy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organization_execution_autonomy_policy_organizationId_key" ON "organization_execution_autonomy_policy"("organizationId");

-- AddForeignKey
ALTER TABLE "organization_execution_autonomy_policy" ADD CONSTRAINT "organization_execution_autonomy_policy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
